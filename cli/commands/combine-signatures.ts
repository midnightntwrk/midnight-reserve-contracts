import { readFileSync } from "fs";
import {
  CborSet,
  Ed25519PublicKeyHex,
  Ed25519SignatureHex,
  HexBlob,
  Transaction,
  TransactionId,
  TransactionWitnessSet,
  TxCBOR,
  VkeyWitness,
} from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";
import type { CombineSignaturesOptions } from "../lib/types";
import { createProvider } from "../lib/provider";
import { printError, printSuccess, printProgress, printInfo } from "../utils/output";
import { signTransaction } from "../utils/transaction";
import { getEnvVar } from "../lib/config";
import { isSingleTransaction, isDeploymentTransactions } from "../utils/transaction-json";

// Configuration for transaction confirmation
const CONFIRMATION_TIMEOUT_MS = 300_000; // 5 minutes
const MAX_SUBMIT_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2_000;

/**
 * cardano-cli TextEnvelope format for witness files
 */
interface TextEnvelope {
  type: string;
  description: string;
  cborHex: string;
}

/**
 * Extracts vkey witnesses from a CBOR-encoded TransactionWitnessSet.
 * This is the format returned by CIP-30 wallet's signTx() method.
 */
function extractVkeysFromWitnessSet(
  cborHex: string,
  signerName: string,
): [Ed25519PublicKeyHex, Ed25519SignatureHex][] {
  let witnessSet: TransactionWitnessSet;
  try {
    witnessSet = TransactionWitnessSet.fromCbor(HexBlob(cborHex));
  } catch (e) {
    throw new Error(
      `Invalid CBOR witness set for signer "${signerName}": ${e instanceof Error ? e.message : e}`,
    );
  }

  const vkeys = witnessSet.vkeys();

  if (!vkeys) {
    printInfo(`No vkey witnesses found for signer: ${signerName}`);
    return [];
  }

  const signatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];
  for (const vkey of vkeys.values()) {
    signatures.push([vkey.vkey(), vkey.signature()]);
  }

  return signatures;
}

/**
 * Detects the format of a witness file by examining its structure.
 * Returns 'cardano-cli' for TextEnvelope format or 'wallet' for raw CBOR hex.
 */
function detectWitnessFormat(
  content: string,
): "cardano-cli" | "wallet" {
  try {
    const parsed = JSON.parse(content);

    // Check if it's a TextEnvelope structure
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      "description" in parsed &&
      "cborHex" in parsed &&
      typeof parsed.type === "string" &&
      typeof parsed.cborHex === "string"
    ) {
      return "cardano-cli";
    }

    // If it's JSON but not TextEnvelope, assume it's the old format (wallet)
    return "wallet";
  } catch {
    // Not JSON, assume it's raw CBOR hex string (wallet format)
    return "wallet";
  }
}

/**
 * Parses a cardano-cli TextEnvelope witness file and extracts vkey witnesses.
 * The CBOR structure is: [witnessType, witnessData]
 * where witnessType = 0 for vkeywitness, and witnessData = [vkey, sig]
 */
function parseCardanoCliWitness(
  envelope: TextEnvelope,
): [Ed25519PublicKeyHex, Ed25519SignatureHex][] {
  const cborHex = envelope.cborHex;

  // Parse the CBOR array [witnessType, witnessData]
  try {
    // cardano-cli format: 82 00 82 5820<vkey> 5840<sig>
    // This is [0, [vkey, sig]]
    // Parse as raw bytes to extract the vkeywitness
    const bytes = Buffer.from(cborHex, "hex");

    // Check CBOR array tag (0x82 = array of 2 elements)
    if (bytes[0] !== 0x82) {
      throw new Error(
        `Expected CBOR array (0x82) at start of cardano-cli witness, got 0x${bytes[0].toString(16)}`,
      );
    }

    // Check witness type (0x00 = vkeywitness)
    if (bytes[1] !== 0x00) {
      throw new Error(
        `Expected vkeywitness type (0x00) in cardano-cli witness, got 0x${bytes[1].toString(16)}`,
      );
    }

    // Next should be another array [vkey, sig]
    if (bytes[2] !== 0x82) {
      throw new Error(
        `Expected CBOR array (0x82) for vkeywitness data, got 0x${bytes[2].toString(16)}`,
      );
    }

    // Extract vkey (0x5820 = bytes of length 32)
    if (bytes[3] !== 0x58 || bytes[4] !== 0x20) {
      throw new Error(
        `Expected byte string of length 32 (0x5820) for vkey, got 0x${bytes[3].toString(16)}${bytes[4].toString(16)}`,
      );
    }

    const vkey = bytes.subarray(5, 37).toString("hex");

    // Extract signature (0x5840 = bytes of length 64)
    if (bytes[37] !== 0x58 || bytes[38] !== 0x40) {
      throw new Error(
        `Expected byte string of length 64 (0x5840) for signature, got 0x${bytes[37].toString(16)}${bytes[38].toString(16)}`,
      );
    }

    const sig = bytes.subarray(39, 103).toString("hex");

    return [[Ed25519PublicKeyHex(vkey), Ed25519SignatureHex(sig)]];
  } catch (e) {
    throw new Error(
      `Failed to parse cardano-cli witness: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * Parses a wallet TransactionWitnessSet (CIP-30 format) and extracts vkey witnesses.
 * This is the same as extractVkeysFromWitnessSet but with a different name for clarity.
 */
function parseWalletWitnessSet(
  cborHex: string,
): [Ed25519PublicKeyHex, Ed25519SignatureHex][] {
  let witnessSet: TransactionWitnessSet;
  try {
    witnessSet = TransactionWitnessSet.fromCbor(HexBlob(cborHex));
  } catch (e) {
    throw new Error(
      `Invalid CBOR witness set: ${e instanceof Error ? e.message : e}`,
    );
  }

  const vkeys = witnessSet.vkeys();

  if (!vkeys) {
    return [];
  }

  const signatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];
  for (const vkey of vkeys.values()) {
    signatures.push([vkey.vkey(), vkey.signature()]);
  }

  return signatures;
}

/**
 * Merges signatures into a transaction, checking for duplicate signers.
 * Throws if the same public key appears with different signatures.
 */
function mergeSignaturesIntoTransaction(
  tx: Transaction,
  newSignatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][],
): Transaction {
  const witnessSet = tx.witnessSet();
  const existingVkeys = witnessSet.vkeys();

  // Build a map of existing signatures
  const signatureMap = new Map<string, Ed25519SignatureHex>();

  if (existingVkeys) {
    for (const vkey of existingVkeys.values()) {
      signatureMap.set(vkey.vkey(), vkey.signature());
    }
  }

  // Add new signatures, checking for conflicts
  // Use lowercase comparison to handle mixed-case hex from different wallets
  for (const [pubKey, sig] of newSignatures) {
    const existingSig = signatureMap.get(pubKey);
    if (existingSig && existingSig.toLowerCase() !== sig.toLowerCase()) {
      throw new Error(
        `Duplicate signer with different signature detected for public key: ${pubKey}`,
      );
    }
    signatureMap.set(pubKey, sig);
  }

  // Build merged signatures array
  const mergedSignatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];
  for (const [pubKey, sig] of signatureMap) {
    mergedSignatures.push([
      Ed25519PublicKeyHex(pubKey),
      Ed25519SignatureHex(sig),
    ]);
  }

  const cborSet = CborSet.fromCore(
    mergedSignatures,
    (i: ReturnType<VkeyWitness["toCore"]>) => VkeyWitness.fromCore(i),
  );

  witnessSet.setVkeys(cborSet);
  tx.setWitnessSet(witnessSet);

  return tx;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("socket") ||
    message.includes("fetch failed") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

function isAlreadySubmittedError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("already") ||
    message.includes("exists") ||
    message.includes("duplicate") ||
    message.includes("known")
  );
}

/**
 * Submits a transaction, returning the txId.
 * Does NOT wait for confirmation.
 */
async function submitTransaction(
  tx: Transaction,
  provider: Provider,
  name: string,
): Promise<TransactionId> {
  const txId = tx.getId();

  for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        printProgress(`Submitting (attempt ${attempt}/${MAX_SUBMIT_RETRIES}): ${name}`);
      }
      await provider.postTransactionToChain(tx);
      return txId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (isAlreadySubmittedError(err)) {
        printInfo(`Transaction may already be submitted: ${name}`);
        return txId;
      }

      if (!isNetworkError(err) || attempt === MAX_SUBMIT_RETRIES) {
        throw err;
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      printInfo(`Network error, retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }

  throw new Error(`Failed to submit transaction ${name}`);
}

/**
 * Awaits confirmation for a previously submitted transaction.
 */
async function awaitTxConfirmation(
  txId: TransactionId,
  provider: Provider,
  name: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    try {
      const confirmed = await provider.awaitTransactionConfirmation(
        txId,
        CONFIRMATION_TIMEOUT_MS,
      );

      if (confirmed === false) {
        throw new Error(
          `Transaction ${txId} was not confirmed within ${CONFIRMATION_TIMEOUT_MS / 1000 / 60} minutes`,
        );
      }

      return;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (!isNetworkError(err) || attempt === MAX_SUBMIT_RETRIES) {
        throw err;
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      printInfo(`Network error during confirmation, retrying in ${delay / 1000}s...`);
      await sleep(delay);
      printProgress(`Awaiting confirmation (attempt ${attempt + 1}/${MAX_SUBMIT_RETRIES}): ${name}`);
    }
  }
}

export async function combineSignatures(
  options: CombineSignaturesOptions,
): Promise<void> {
  const {
    network,
    provider: providerType,
    txFile,
    witnessFiles,
    signDeployer,
    signingKeyEnvVar,
  } = options;

  const provider = await createProvider(network, providerType);
  const deployerPrivateKey = signDeployer ? getEnvVar(signingKeyEnvVar) : null;

  if (signDeployer) {
    printProgress(`Will also sign with deployer key from ${signingKeyEnvVar}`);
  }

  // Load and parse each witness file
  const allSignatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];

  for (const witnessFile of witnessFiles) {
    let content: string;
    try {
      content = readFileSync(witnessFile, "utf-8");
    } catch (e) {
      throw new Error(
        `Witness file not found: ${witnessFile} (${e instanceof Error ? e.message : e})`,
      );
    }

    const format = detectWitnessFormat(content);

    let vkeys: [Ed25519PublicKeyHex, Ed25519SignatureHex][];

    try {
      switch (format) {
        case "cardano-cli": {
          const envelope = JSON.parse(content) as TextEnvelope;
          vkeys = parseCardanoCliWitness(envelope);
          break;
        }
        case "wallet": {
          // Check if it's the old JSON format (SignaturesJson) or raw CBOR hex
          let cborHex: string;
          try {
            const parsed = JSON.parse(content);
            // Old format: { "name": "cborHex", ... }
            // Just take the first value as CBOR hex
            if (typeof parsed === "object" && parsed !== null) {
              const values = Object.values(parsed);
              if (values.length > 0 && typeof values[0] === "string") {
                cborHex = values[0] as string;
                if (values.length > 1) {
                  printInfo(
                    `  Note: Old format detected with multiple entries, using first entry only`,
                  );
                  printInfo(
                    `  Consider using separate witness files for each signer`,
                  );
                }
              } else {
                throw new Error("Invalid wallet witness format");
              }
            } else {
              throw new Error("Invalid wallet witness format");
            }
          } catch {
            // Not JSON, assume it's raw CBOR hex string
            cborHex = content.trim();
          }

          vkeys = parseWalletWitnessSet(cborHex);
          break;
        }
      }

      printInfo(`  Extracted ${vkeys.length} signature(s) from ${witnessFile}`);
      allSignatures.push(...vkeys);
    } catch (e) {
      throw new Error(
        `Failed to parse witness file ${witnessFile}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  if (allSignatures.length === 0) {
    throw new Error("No valid signatures found across all witness files");
  }

  printInfo(`Total signatures to merge: ${allSignatures.length}`);

  // Load transaction file
  const txContent = readFileSync(txFile, "utf-8");
  const txJson = JSON.parse(txContent);

  const confirmedHashes: TransactionId[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  if (isDeploymentTransactions(txJson)) {
    // Handle deployment-transactions.json format (multiple transactions)
    printProgress(
      `Found ${txJson.transactions.length} transactions to process`,
    );

    // Phase 1: Merge signatures and submit all transactions
    const submissions: Array<{ name: string; txId: TransactionId }> = [];
    const submitErrors: Array<{ name: string; error: string }> = [];

    for (const txData of txJson.transactions) {
      try {
        const tx = Transaction.fromCbor(TxCBOR(HexBlob(txData.cborHex)));

        let signedTx = mergeSignaturesIntoTransaction(tx, allSignatures);

        // Add deployer signature if requested
        if (deployerPrivateKey) {
          const txId = signedTx.getId();
          const deployerSigs = signTransaction(txId as string, [deployerPrivateKey]);
          signedTx = mergeSignaturesIntoTransaction(signedTx, deployerSigs);
          printInfo(`  Added deployer signature`);
        }

        const txId = await submitTransaction(signedTx, provider, txData.description);
        submissions.push({ name: txData.description, txId });
        printSuccess(`Submitted: ${txData.description} - ${txId}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        submitErrors.push({ name: txData.description, error: errorMsg });
        printError(`Failed to submit ${txData.description}: ${errorMsg}`);
      }
    }

    if (submissions.length > 0) {
      printProgress(
        `\nSubmitted ${submissions.length}/${txJson.transactions.length} transactions. Awaiting confirmations...`,
      );
    }

    // Phase 2: Await confirmations
    for (const { name, txId } of submissions) {
      try {
        await awaitTxConfirmation(txId, provider, name);
        confirmedHashes.push(txId);
        printSuccess(`Confirmed: ${name} - ${txId}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ name, error: errorMsg });
        printError(`Confirmation failed for ${name}: ${errorMsg}`);
      }
    }

    errors.push(...submitErrors);
  } else if (isSingleTransaction(txJson)) {
    // Handle single transaction format
    try {
      const tx = Transaction.fromCbor(TxCBOR(HexBlob(txJson.cborHex)));

      let signedTx = mergeSignaturesIntoTransaction(tx, allSignatures);

      // Add deployer signature if requested
      if (deployerPrivateKey) {
        const txId = signedTx.getId();
        const deployerSigs = signTransaction(txId as string, [deployerPrivateKey]);
        signedTx = mergeSignaturesIntoTransaction(signedTx, deployerSigs);
        printInfo(`Added deployer signature`);
      }

      const txId = await submitTransaction(signedTx, provider, txJson.description);
      await awaitTxConfirmation(txId, provider, txJson.description);
      confirmedHashes.push(txId);
      printSuccess(`Confirmed: ${txId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ name: txJson.description, error: errorMsg });
      printError(`Failed: ${errorMsg}`);
    }
  } else {
    throw new Error(
      "Unrecognized JSON format. Expected transaction file or deployment-transactions.json",
    );
  }

  console.log("\n--- Summary ---");
  if (confirmedHashes.length > 0) {
    console.log(
      `\nSuccessfully confirmed ${confirmedHashes.length} transaction(s):`,
    );
    for (const hash of confirmedHashes) {
      console.log(`  ${hash}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nFailed ${errors.length} transaction(s):`);
    for (const { name, error } of errors) {
      console.log(`  ${name}: ${error}`);
    }
    process.exit(1);
  }
}

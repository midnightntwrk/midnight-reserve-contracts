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

// Configuration for transaction confirmation
const CONFIRMATION_TIMEOUT_MS = 300_000; // 5 minutes
const MAX_SUBMIT_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2_000;

interface TransactionJson {
  cbor: string;
  txHash: string;
  signed: boolean;
}

interface DeploymentTransactionsJson {
  transactions: Array<{
    name: string;
    cbor: string[];
    hash: string;
  }>;
}

/**
 * Signature file format: maps names to CBOR-encoded TransactionWitnessSet hex strings.
 * Names are for logging only; the actual witness data is extracted from the CBOR.
 */
type SignaturesJson = Record<string, string>;

function isDeploymentTransactions(
  data: unknown,
): data is DeploymentTransactionsJson {
  return (
    typeof data === "object" &&
    data !== null &&
    "transactions" in data &&
    Array.isArray((data as DeploymentTransactionsJson).transactions)
  );
}

function isSingleTransaction(data: unknown): data is TransactionJson {
  return (
    typeof data === "object" &&
    data !== null &&
    "cbor" in data &&
    typeof (data as TransactionJson).cbor === "string"
  );
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
      } else {
        printProgress(`Submitting: ${name}`);
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
  printProgress(`Awaiting confirmation: ${name}`);

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
  const { network, provider: providerType, txFile, signaturesFile } = options;

  const provider = await createProvider(network, providerType);

  // Load signatures file
  printProgress(`Reading signatures file: ${signaturesFile}`);
  const signaturesContent = readFileSync(signaturesFile, "utf-8");
  const signaturesJson: SignaturesJson = JSON.parse(signaturesContent);

  // Validate signatures file structure
  for (const [name, value] of Object.entries(signaturesJson)) {
    if (typeof value !== "string") {
      throw new Error(
        `Invalid signature for "${name}": expected hex string, got ${typeof value}`,
      );
    }
  }

  // Extract all signatures from wallet witness sets
  const allSignatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];
  for (const [signerName, cborHex] of Object.entries(signaturesJson)) {
    printProgress(`Extracting signatures from: ${signerName}`);
    const vkeys = extractVkeysFromWitnessSet(cborHex, signerName);
    printInfo(`  Found ${vkeys.length} vkey witness(es)`);
    allSignatures.push(...vkeys);
  }

  if (allSignatures.length === 0) {
    throw new Error("No signatures found in signatures file");
  }

  printInfo(`Total signatures to merge: ${allSignatures.length}`);

  // Load transaction file
  printProgress(`Reading transaction file: ${txFile}`);
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
        const cbor = Array.isArray(txData.cbor) ? txData.cbor[0] : txData.cbor;
        const tx = Transaction.fromCbor(TxCBOR(HexBlob(cbor)));

        printProgress(`Merging signatures into: ${txData.name}`);
        const signedTx = mergeSignaturesIntoTransaction(tx, allSignatures);

        const txId = await submitTransaction(signedTx, provider, txData.name);
        submissions.push({ name: txData.name, txId });
        printSuccess(`Submitted: ${txData.name} - ${txId}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        submitErrors.push({ name: txData.name, error: errorMsg });
        printError(`Failed to submit ${txData.name}: ${errorMsg}`);
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
      const tx = Transaction.fromCbor(TxCBOR(HexBlob(txJson.cbor)));

      printProgress("Merging signatures into transaction");
      const signedTx = mergeSignaturesIntoTransaction(tx, allSignatures);

      const txId = await submitTransaction(signedTx, provider, "transaction");
      await awaitTxConfirmation(txId, provider, "transaction");
      confirmedHashes.push(txId);
      printSuccess(`Confirmed: ${txId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ name: "transaction", error: errorMsg });
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

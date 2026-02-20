import type { Argv, CommandModule } from "yargs";
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

import type { GlobalOptions } from "../../lib/global-options";
import { createProvider } from "../../lib/provider";
import { signTransaction } from "../../lib/transaction";
import { getEnvVar } from "../../lib/config";
import {
  printError,
  printSuccess,
  printProgress,
  printInfo,
} from "../../lib/output";
import {
  isSingleTransaction,
  isDeploymentTransactions,
} from "../../lib/transaction-json";

import { submitWithRetry, awaitTxConfirmation } from "../../lib/submit";

interface CombineSignaturesOptions extends GlobalOptions {
  tx: string;
  signatures: string[];
  "signing-key": string;
  "sign-deployer": boolean;
}

export const command = "combine-signatures";
export const describe =
  "Combine wallet signatures into a single transaction and submit";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("tx", {
      type: "string",
      demandOption: true,
      description: "Path to transaction file",
    })
    .option("signatures", {
      type: "string",
      array: true,
      demandOption: true,
      description:
        "Path(s) to witness files (cardano-cli TextEnvelope or CIP-30 wallet CBOR)",
    })
    .option("signing-key", {
      type: "string",
      default: "SIGNING_PRIVATE_KEY",
      description:
        "Environment variable name containing the deployer key (default: SIGNING_PRIVATE_KEY)",
    })
    .option("sign-deployer", {
      type: "boolean",
      default: true,
      description: "Also sign with deployer key after merging (default: true)",
    })
    .epilogue(
      "Merges external witness files into a single transaction and submits it.\n" +
        "The --tx file must contain exactly one transaction (single-tx JSON format).\n" +
        "For multi-transaction deployments, use the deploy command instead.",
    );
}

// --- Witness parsing helpers ---

interface TextEnvelope {
  type: string;
  description: string;
  cborHex: string;
}

function detectWitnessFormat(content: string): "cardano-cli" | "wallet" {
  try {
    const parsed = JSON.parse(content);
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
    return "wallet";
  } catch {
    return "wallet";
  }
}

function parseCardanoCliWitness(
  envelope: TextEnvelope,
): [Ed25519PublicKeyHex, Ed25519SignatureHex][] {
  try {
    const bytes = Buffer.from(envelope.cborHex, "hex");

    if (bytes[0] !== 0x82) {
      throw new Error(
        `Expected CBOR array (0x82) at start of cardano-cli witness, got 0x${bytes[0].toString(16)}`,
      );
    }
    if (bytes[1] !== 0x00) {
      throw new Error(
        `Expected vkeywitness type (0x00), got 0x${bytes[1].toString(16)}`,
      );
    }
    if (bytes[2] !== 0x82) {
      throw new Error(
        `Expected CBOR array (0x82) for vkeywitness data, got 0x${bytes[2].toString(16)}`,
      );
    }
    if (bytes[3] !== 0x58 || bytes[4] !== 0x20) {
      throw new Error(
        `Expected byte string of length 32 (0x5820) for vkey, got 0x${bytes[3].toString(16)}${bytes[4].toString(16)}`,
      );
    }
    const vkey = bytes.subarray(5, 37).toString("hex");

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
  if (!vkeys) return [];

  const signatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];
  for (const vkey of vkeys.values()) {
    signatures.push([vkey.vkey(), vkey.signature()]);
  }
  return signatures;
}

function mergeSignaturesIntoTransaction(
  tx: Transaction,
  newSignatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][],
): Transaction {
  const witnessSet = tx.witnessSet();
  const existingVkeys = witnessSet.vkeys();
  const signatureMap = new Map<string, Ed25519SignatureHex>();

  if (existingVkeys) {
    for (const vkey of existingVkeys.values()) {
      signatureMap.set(vkey.vkey(), vkey.signature());
    }
  }

  for (const [pubKey, sig] of newSignatures) {
    const existingSig = signatureMap.get(pubKey);
    if (existingSig && existingSig.toLowerCase() !== sig.toLowerCase()) {
      throw new Error(
        `Duplicate signer with different signature detected for public key: ${pubKey}`,
      );
    }
    signatureMap.set(pubKey, sig);
  }

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

// --- Main handler ---

export async function handler(argv: CombineSignaturesOptions) {
  const {
    network,
    tx: txFile,
    signatures: witnessFiles,
    "signing-key": signingKeyEnvVar,
    "sign-deployer": signDeployer,
  } = argv;

  const provider = await createProvider(network, argv.provider);
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
          let cborHex: string;
          try {
            const parsed = JSON.parse(content);
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
    throw new Error(
      "combine-signatures only supports single-transaction files. " +
        "For multi-transaction deployments, use sign-and-submit instead.",
    );
  } else if (isSingleTransaction(txJson)) {
    try {
      const tx = Transaction.fromCbor(TxCBOR(HexBlob(txJson.cborHex)));
      let signedTx = mergeSignaturesIntoTransaction(tx, allSignatures);

      if (deployerPrivateKey) {
        const txId = signedTx.getId();
        const deployerSigs = signTransaction(txId as string, [
          deployerPrivateKey,
        ]);
        signedTx = mergeSignaturesIntoTransaction(signedTx, deployerSigs);
        printInfo(`Added deployer signature`);
      }

      const txId = await submitWithRetry(
        signedTx,
        provider,
        txJson.description,
      );
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

const commandModule: CommandModule<GlobalOptions, CombineSignaturesOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

import { readFileSync } from "fs";
import { HexBlob, Transaction, TxCBOR } from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";
import type { Network, ProviderType } from "../lib/types";
import { createProvider } from "../lib/provider";
import { signTransaction, attachWitnesses } from "../utils/transaction";
import { printError, printSuccess, printProgress } from "../utils/output";
import { getEnvVar } from "../lib/config";

export interface SignAndSubmitOptions {
  network: Network;
  provider: ProviderType;
  jsonFile: string;
  signingKeyEnvVar: string;
}

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

export async function signAndSubmit(
  options: SignAndSubmitOptions,
): Promise<void> {
  const {
    network,
    provider: providerType,
    jsonFile,
    signingKeyEnvVar,
  } = options;

  // Get private key from environment variable
  const privateKeyHex = getEnvVar(signingKeyEnvVar);

  // Create provider for submission
  const provider = createProvider(network, providerType);

  // Read and parse JSON file
  printProgress(`Reading transaction file: ${jsonFile}`);
  const fileContent = readFileSync(jsonFile, "utf-8");
  const jsonData = JSON.parse(fileContent);

  const submittedHashes: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  if (isDeploymentTransactions(jsonData)) {
    // Handle deployment-transactions.json format (multiple transactions)
    printProgress(
      `Found ${jsonData.transactions.length} transactions to process`,
    );

    for (const tx of jsonData.transactions) {
      try {
        // deployment-transactions.json has cbor as an array, take first element
        const cbor = Array.isArray(tx.cbor) ? tx.cbor[0] : tx.cbor;
        const hash = await processAndSubmitTransaction(
          cbor,
          privateKeyHex,
          await provider,
          tx.name,
        );
        submittedHashes.push(hash);
        printSuccess(`Submitted: ${tx.name} - ${hash}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ name: tx.name, error: errorMsg });
        printError(`Failed to submit ${tx.name}: ${errorMsg}`);
      }
    }
  } else if (isSingleTransaction(jsonData)) {
    // Handle single transaction format (e.g., simple-tx.json)
    try {
      const hash = await processAndSubmitTransaction(
        jsonData.cbor,
        privateKeyHex,
        await provider,
        "transaction",
      );
      submittedHashes.push(hash);
      printSuccess(`Submitted: ${hash}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ name: "transaction", error: errorMsg });
      printError(`Failed to submit transaction: ${errorMsg}`);
    }
  } else {
    throw new Error(
      "Unrecognized JSON format. Expected transaction file or deployment-transactions.json",
    );
  }

  // Final summary
  console.log("\n--- Submission Summary ---");
  if (submittedHashes.length > 0) {
    console.log(
      `\nSuccessfully submitted ${submittedHashes.length} transaction(s):`,
    );
    for (const hash of submittedHashes) {
      console.log(`  ${hash}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nFailed to submit ${errors.length} transaction(s):`);
    for (const { name, error } of errors) {
      console.log(`  ${name}: ${error}`);
    }
    process.exit(1);
  }
}

async function processAndSubmitTransaction(
  cbor: string,
  privateKeyHex: string,
  provider: Provider,
  name: string,
): Promise<string> {
  printProgress(`Processing: ${name}`);

  // Parse the transaction
  const tx = Transaction.fromCbor(TxCBOR(HexBlob(cbor)));
  const txId = tx.getId();

  // Sign the transaction
  const signatures = signTransaction(txId, [privateKeyHex]);
  const signedTx = attachWitnesses(tx.toCbor(), signatures);

  // Submit the transaction
  printProgress(`Submitting: ${name}`);
  const submittedHash = await provider.postTransactionToChain(signedTx);

  return submittedHash;
}

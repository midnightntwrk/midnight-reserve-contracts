import { readFileSync } from "fs";
import { HexBlob, Transaction, TransactionId, TxCBOR } from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";
import type { SignAndSubmitOptions } from "../lib/types";
import { createProvider } from "../lib/provider";
import { signTransaction, attachWitnesses } from "../utils/transaction";
import { printError, printSuccess, printProgress, printInfo } from "../utils/output";
import { getEnvVar } from "../lib/config";

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
    signDeployer,
  } = options;

  const privateKeyHex = signDeployer ? getEnvVar(signingKeyEnvVar) : null;
  const provider = await createProvider(network, providerType);

  if (signDeployer) {
    printProgress(`Signing with deployer key from ${signingKeyEnvVar}`);
  } else {
    printProgress(`Submitting without deployer signature (--no-sign-deployer)`);
  }

  printProgress(`Reading transaction file: ${jsonFile}`);
  const fileContent = readFileSync(jsonFile, "utf-8");
  const jsonData = JSON.parse(fileContent);

  const confirmedHashes: TransactionId[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  if (isDeploymentTransactions(jsonData)) {
    // Handle deployment-transactions.json format (multiple transactions)
    // Phase 1: Submit all transactions first to maximize mempool parallelism
    // Phase 2: Then await confirmations for all submitted transactions
    printProgress(
      `Found ${jsonData.transactions.length} transactions to process`,
    );

    // Phase 1: Submit all transactions
    const submissions: Array<{ name: string; txId: TransactionId }> = [];
    const submitErrors: Array<{ name: string; error: string }> = [];

    for (const tx of jsonData.transactions) {
      try {
        const cbor = Array.isArray(tx.cbor) ? tx.cbor[0] : tx.cbor;
        const txId = await signAndSubmitTransaction(
          cbor,
          privateKeyHex,
          provider,
          tx.name,
        );
        submissions.push({ name: tx.name, txId });
        printSuccess(`Submitted: ${tx.name} - ${txId}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        submitErrors.push({ name: tx.name, error: errorMsg });
        printError(`Failed to submit ${tx.name}: ${errorMsg}`);
      }
    }

    // Report submission phase summary
    if (submissions.length > 0) {
      printProgress(
        `\nSubmitted ${submissions.length}/${jsonData.transactions.length} transactions. Awaiting confirmations...`,
      );
    }

    // Phase 2: Await confirmations for all submitted transactions
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

    // Add submission errors to the errors list
    errors.push(...submitErrors);
  } else if (isSingleTransaction(jsonData)) {
    // Handle single transaction format (e.g., simple-tx.json)
    try {
      const hash = await processAndSubmitTransaction(
        jsonData.cbor,
        privateKeyHex,
        provider,
        "transaction",
      );
      confirmedHashes.push(hash);
      printSuccess(`Confirmed: ${hash}`);
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
 * Optionally signs and submits a transaction, returning the txId.
 * Does NOT wait for confirmation - use awaitTxConfirmation for that.
 * @param privateKeyHex - If provided, signs the transaction. If null, submits as-is.
 */
async function signAndSubmitTransaction(
  cbor: string,
  privateKeyHex: string | null,
  provider: Provider,
  name: string,
): Promise<TransactionId> {
  printProgress(`Processing: ${name}`);

  const tx = Transaction.fromCbor(TxCBOR(HexBlob(cbor)));
  const txId = tx.getId();

  // Sign if private key provided, otherwise submit as-is
  let signedTx: Transaction;
  if (privateKeyHex) {
    const signatures = signTransaction(txId, [privateKeyHex]);
    signedTx = attachWitnesses(tx.toCbor() as string, signatures);
  } else {
    signedTx = tx;
  }

  // Submit with retry logic for network errors
  for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        printProgress(`Submitting (attempt ${attempt}/${MAX_SUBMIT_RETRIES}): ${name}`);
      } else {
        printProgress(`Submitting: ${name}`);
      }
      await provider.postTransactionToChain(signedTx);
      return txId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // If transaction is already in mempool/chain, return the txId for confirmation
      if (isAlreadySubmittedError(err)) {
        printInfo(`Transaction may already be submitted: ${name}`);
        return txId;
      }

      // Only retry on network errors
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

      // Only retry on network errors during confirmation polling
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

/**
 * Optionally signs, submits, and awaits confirmation for a single transaction.
 * Used for single-transaction mode where parallel submission doesn't apply.
 * @param privateKeyHex - If provided, signs the transaction. If null, submits as-is.
 */
async function processAndSubmitTransaction(
  cbor: string,
  privateKeyHex: string | null,
  provider: Provider,
  name: string,
): Promise<TransactionId> {
  const txId = await signAndSubmitTransaction(cbor, privateKeyHex, provider, name);
  await awaitTxConfirmation(txId, provider, name);
  return txId;
}

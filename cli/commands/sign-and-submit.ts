import { readFileSync } from "fs";
import {
  HexBlob,
  Transaction,
  TransactionId,
  TxCBOR,
} from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";
import type { SignAndSubmitOptions } from "../lib/types";
import { createProvider } from "../lib/provider";
import { signTransaction, attachWitnesses } from "../utils/transaction";
import {
  printError,
  printSuccess,
  printProgress,
  printInfo,
} from "../utils/output";
import { getEnvVar } from "../lib/config";
import {
  isSingleTransaction,
  isDeploymentTransactions,
} from "../utils/transaction-json";
import {
  CONFIRMATION_TIMEOUT_MS,
  MAX_SUBMIT_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  sleep,
  isNetworkError,
  isAlreadySubmittedError,
  awaitTxConfirmation,
} from "../utils/submit";

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
        const txId = await signAndSubmitTransaction(
          tx.cborHex,
          privateKeyHex,
          provider,
          tx.description,
        );
        submissions.push({ name: tx.description, txId });
        printSuccess(`Submitted: ${tx.description} - ${txId}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        submitErrors.push({ name: tx.description, error: errorMsg });
        printError(`Failed to submit ${tx.description}: ${errorMsg}`);
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
        jsonData.cborHex,
        privateKeyHex,
        provider,
        jsonData.description,
      );
      confirmedHashes.push(hash);
      printSuccess(`Confirmed: ${hash}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ name: jsonData.description, error: errorMsg });
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
        printProgress(
          `Submitting (attempt ${attempt}/${MAX_SUBMIT_RETRIES}): ${name}`,
        );
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
  const txId = await signAndSubmitTransaction(
    cbor,
    privateKeyHex,
    provider,
    name,
  );
  await awaitTxConfirmation(txId, provider, name);
  return txId;
}

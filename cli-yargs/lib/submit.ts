import type { Provider } from "@blaze-cardano/sdk";
import type { Transaction, TransactionId } from "@blaze-cardano/core";
import { printInfo, printProgress } from "./output";

// Configuration for transaction confirmation
export const CONFIRMATION_TIMEOUT_MS = 300_000; // 5 minutes
export const MAX_SUBMIT_RETRIES = 3;
export const INITIAL_RETRY_DELAY_MS = 2_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isNetworkError(error: Error): boolean {
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

/**
 * Checks whether a transaction is already confirmed on-chain.
 * Uses awaitTransactionConfirmation with a minimal timeout so it performs
 * a single lookup rather than polling.
 */
async function isAlreadyOnChain(
  txId: TransactionId,
  provider: Provider,
): Promise<boolean> {
  try {
    return await provider.awaitTransactionConfirmation(txId, 1);
  } catch {
    return false;
  }
}

/**
 * Submits a signed transaction with retry on network errors.
 * On submit failure, queries the chain to check if the tx already landed
 * rather than relying on error string matching.
 */
export async function submitWithRetry(
  tx: Transaction,
  provider: Provider,
  name: string,
): Promise<TransactionId> {
  const txId = tx.getId();

  for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        printProgress(
          `Submitting (attempt ${attempt}/${MAX_SUBMIT_RETRIES}): ${name}`,
        );
      } else {
        printProgress(`Submitting: ${name}`);
      }
      await provider.postTransactionToChain(tx);
      return txId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Before giving up, check if the tx already landed on-chain
      // (e.g. from a previous submission attempt that succeeded but
      // whose response was lost due to a network error)
      if (await isAlreadyOnChain(txId, provider)) {
        printInfo(`Transaction already confirmed on-chain: ${name}`);
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
export async function awaitTxConfirmation(
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

      // Only retry on network errors during confirmation polling
      if (!isNetworkError(err) || attempt === MAX_SUBMIT_RETRIES) {
        throw err;
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      printInfo(
        `Network error during confirmation, retrying in ${delay / 1000}s...`,
      );
      await sleep(delay);
      printProgress(
        `Awaiting confirmation (attempt ${attempt + 1}/${MAX_SUBMIT_RETRIES}): ${name}`,
      );
    }
  }
}

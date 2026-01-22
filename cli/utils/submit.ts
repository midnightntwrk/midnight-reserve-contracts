import type { Provider } from "@blaze-cardano/sdk";
import type { TransactionId } from "@blaze-cardano/core";
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

export function isAlreadySubmittedError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("already") ||
    message.includes("exists") ||
    message.includes("duplicate") ||
    message.includes("known")
  );
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
      printInfo(`Network error during confirmation, retrying in ${delay / 1000}s...`);
      await sleep(delay);
      printProgress(`Awaiting confirmation (attempt ${attempt + 1}/${MAX_SUBMIT_RETRIES}): ${name}`);
    }
  }
}

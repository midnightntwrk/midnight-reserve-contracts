import type { TransactionOutput, DeploymentTransactionsJson } from "./types";

export function isSingleTransaction(data: unknown): data is TransactionOutput {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.type === "string" &&
    typeof obj.description === "string" &&
    typeof obj.cborHex === "string" &&
    typeof obj.txHash === "string" &&
    typeof obj.signed === "boolean"
  );
}

export function isDeploymentTransactions(
  data: unknown,
): data is DeploymentTransactionsJson {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;

  if (!("transactions" in obj) || !Array.isArray(obj.transactions)) {
    return false;
  }

  // Validate that all array elements are valid TransactionOutput objects
  return obj.transactions.every((tx) => isSingleTransaction(tx));
}

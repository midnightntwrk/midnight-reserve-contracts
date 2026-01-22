import type { TransactionOutput, DeploymentTransactionsJson } from "../lib/types";

export function isSingleTransaction(data: unknown): data is TransactionOutput {
  return (
    typeof data === "object" &&
    data !== null &&
    "cborHex" in data &&
    typeof (data as TransactionOutput).cborHex === "string"
  );
}

export function isDeploymentTransactions(
  data: unknown,
): data is DeploymentTransactionsJson {
  return (
    typeof data === "object" &&
    data !== null &&
    "transactions" in data &&
    Array.isArray((data as DeploymentTransactionsJson).transactions)
  );
}

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { DeploymentOutput, TransactionOutput, TransactionFileOutput } from "../lib/types";

export function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function writeTransactionFile(
  filePath: string,
  cbor: string,
  txHash: string,
  signed: boolean,
): void {
  const output: TransactionFileOutput = { cbor, txHash, signed };
  writeJsonFile(filePath, output);
}

export function createDeploymentOutput(
  network: string,
  config: { utxoAmount: bigint; outputAmount: bigint; thresholdOutputAmount: bigint },
  transactions: TransactionOutput[],
): DeploymentOutput {
  return {
    network,
    timestamp: new Date().toISOString(),
    config: {
      utxoAmount: config.utxoAmount.toString(),
      outputAmount: config.outputAmount.toString(),
      thresholdOutputAmount: config.thresholdOutputAmount.toString(),
    },
    transactions,
  };
}

export function printTable(
  headers: string[],
  rows: string[][],
  columnWidths?: number[],
): void {
  const widths =
    columnWidths ||
    headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] || "").length)),
    );

  const separator = widths.map((w) => "-".repeat(w + 2)).join("+");
  const formatRow = (row: string[]) =>
    row.map((cell, i) => ` ${(cell || "").padEnd(widths[i])} `).join("|");

  console.log(separator);
  console.log(formatRow(headers));
  console.log(separator);
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log(separator);
}

export function printSuccess(message: string): void {
  console.log(`\n✅ ${message}`);
}

export function printError(message: string): void {
  console.error(`\n❌ ${message}`);
}

export function printInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

export function printProgress(message: string): void {
  console.log(`⏳ ${message}`);
}

export function printTransactionSummary(transactions: TransactionOutput[]): void {
  console.log(`\nTransaction Summary:`);
  transactions.forEach((tx, index) => {
    console.log(`${index + 1}. ${tx.name}`);
    console.log(`   Hash: ${tx.hash}`);
    console.log(``);
  });
}

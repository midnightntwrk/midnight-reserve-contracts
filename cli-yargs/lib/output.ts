import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { DeploymentOutput, TransactionOutput } from "./types";

export function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export const TX_TYPE_CONWAY = "Tx ConwayEra";

export function writeTransactionFile(
  filePath: string,
  cbor: string,
  txHash: string,
  signed: boolean,
  description: string,
): void {
  const output: TransactionOutput = {
    type: TX_TYPE_CONWAY,
    description,
    cborHex: cbor,
    txHash,
    signed,
  };
  writeJsonFile(filePath, output);
}

export function createDeploymentOutput(
  network: string,
  config: {
    utxoAmount: bigint;
  },
  transactions: TransactionOutput[],
): DeploymentOutput {
  return {
    network,
    timestamp: new Date().toISOString(),
    config: {
      utxoAmount: config.utxoAmount.toString(),
    },
    transactions,
  };
}

export function formatLovelaceToAda(lovelace: bigint): string {
  const ADA_DECIMALS = 1_000_000n;
  const sign = lovelace < 0n ? "-" : "";
  const absolute = lovelace < 0n ? -lovelace : lovelace;
  const whole = absolute / ADA_DECIMALS;
  const fractional = absolute % ADA_DECIMALS;

  return `${sign}${whole}.${fractional.toString().padStart(6, "0")}`;
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
  console.log(`\u2705 ${message}\n`);
}

export function printError(message: string): void {
  console.error(`\u274C ${message}\n`);
}

export function printWarning(message: string): void {
  console.warn(`\u26A0\uFE0F  ${message}\n`);
}

export function printInfo(message: string): void {
  console.log(`\u2139\uFE0F  ${message}`);
}

export function printProgress(message: string): void {
  console.log(`\u23F3 ${message}`);
}

export function printTransactionSummary(
  transactions: TransactionOutput[],
): void {
  console.log(`\nTransaction Summary:`);
  transactions.forEach((tx, index) => {
    console.log(`${index + 1}. ${tx.description}`);
    console.log(`   Hash: ${tx.txHash}`);
    console.log(``);
  });
}

import { Transaction, HexBlob, TxCBOR } from "@blaze-cardano/core";
import type { TransactionOutput } from "../types";
import type { ResolvedInput } from "./resolve-inputs";
import { analyzeFederatedOpsDiff } from "./analyzers/federated-ops";

export interface SemanticDiff {
  commandType: string;
  changes: DiffEntry[];
}

export interface DiffEntry {
  type: "added" | "removed" | "unchanged";
  description: string;
  detail?: Record<string, string>;
}

/**
 * Detect command type from CIP-20 metadata (label 674) in the structural JSON.
 * Looks for "midnight-reserve:<command>" anywhere in the decoded output.
 */
export function detectCommandType(structuralJson: unknown): string | null {
  const text = JSON.stringify(structuralJson);
  const match = text.match(/"midnight-reserve:([^"]+)"/);
  return match ? match[1] : null;
}

export async function generateSemanticDiff(
  commandType: string,
  txJson: TransactionOutput,
  resolvedInputs: ResolvedInput[],
): Promise<SemanticDiff> {
  const tx = Transaction.fromCbor(TxCBOR(HexBlob(txJson.cborHex)));

  switch (commandType) {
    case "change-federated-ops":
      return analyzeFederatedOpsDiff(tx, resolvedInputs);
    default:
      return { commandType, changes: [] };
  }
}

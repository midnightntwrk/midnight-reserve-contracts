import type { Transaction } from "@blaze-cardano/core";
import { PlutusData, HexBlob } from "@blaze-cardano/core";
import { getDatumHandler, extractLogicRound } from "../../datum-versions";
import type { PermissionedCandidate } from "../../candidates";
import type { ResolvedInput } from "../resolve-inputs";
import type { SemanticDiff, DiffEntry } from "../semantic";

/**
 * Extract candidates from a raw CBOR datum hex string using the existing
 * getDatumHandler infrastructure (same decode path as change-federated-ops).
 */
function extractCandidatesFromDatum(
  cborHex: string,
): PermissionedCandidate[] | null {
  try {
    const datum = PlutusData.fromCbor(HexBlob(cborHex));
    const list = datum.asList();
    if (!list || list.getLength() < 3) return null;
    const logicRound = extractLogicRound(datum);
    const handler = getDatumHandler("federated-ops", logicRound);
    const decoded = handler.decode(datum);
    return handler.getCandidates!(decoded);
  } catch {
    return null;
  }
}

export function analyzeFederatedOpsDiff(
  tx: Transaction,
  resolvedInputs: ResolvedInput[],
): SemanticDiff {
  // Old candidates: from the consumed script input's inline datum
  const spendInputs = resolvedInputs.filter((i) => !i.isReferenceInput);
  let oldCandidates: PermissionedCandidate[] | null = null;
  for (const input of spendInputs) {
    if (!input.inlineDatum) continue;
    oldCandidates = extractCandidatesFromDatum(input.inlineDatum);
    if (oldCandidates) break;
  }

  // New candidates: from the tx output with an inline datum
  let newCandidates: PermissionedCandidate[] | null = null;
  const outputs = [...tx.body().outputs().values()];
  for (const output of outputs) {
    try {
      const datum = output.datum()?.asInlineData();
      if (!datum) continue;
      const list = datum.asList();
      if (!list || list.getLength() < 3) continue;
      const logicRound = extractLogicRound(datum);
      const handler = getDatumHandler("federated-ops", logicRound);
      const decoded = handler.decode(datum);
      newCandidates = handler.getCandidates!(decoded);
      break;
    } catch {
      continue;
    }
  }

  if (!oldCandidates || !newCandidates) {
    return {
      commandType: "change-federated-ops",
      changes: [
        {
          type: "unchanged",
          description: "Could not decode federated-ops datums for diff",
        },
      ],
    };
  }

  // Diff by sidechain_pub_key
  const oldKeys = new Set(oldCandidates.map((c) => c.sidechain_pub_key));
  const newKeys = new Set(newCandidates.map((c) => c.sidechain_pub_key));
  const changes: DiffEntry[] = [];

  for (const c of newCandidates) {
    if (!oldKeys.has(c.sidechain_pub_key)) {
      changes.push({
        type: "added",
        description: `Candidate ${c.sidechain_pub_key.slice(0, 16)}...`,
        detail: { ...c },
      });
    }
  }
  for (const c of oldCandidates) {
    if (!newKeys.has(c.sidechain_pub_key)) {
      changes.push({
        type: "removed",
        description: `Candidate ${c.sidechain_pub_key.slice(0, 16)}...`,
        detail: { ...c },
      });
    }
  }
  for (const c of newCandidates) {
    if (oldKeys.has(c.sidechain_pub_key)) {
      changes.push({
        type: "unchanged",
        description: `Candidate ${c.sidechain_pub_key.slice(0, 16)}...`,
      });
    }
  }

  return { commandType: "change-federated-ops", changes };
}

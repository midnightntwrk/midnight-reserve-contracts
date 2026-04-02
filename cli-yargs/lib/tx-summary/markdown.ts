import type { TransactionOutput } from "../types";
import type { SemanticDiff } from "./semantic";
import type { ResolvedInput } from "./resolve-inputs";

export function renderMarkdown(
  txJson: TransactionOutput,
  structuralJson: unknown,
  resolvedInputs: ResolvedInput[],
  semanticDiff: SemanticDiff | null,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`## Transaction Summary`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Description** | ${txJson.description} |`);
  lines.push(`| **Tx Hash** | \`${txJson.txHash}\` |`);
  lines.push(`| **Signed** | ${txJson.signed ? "Yes" : "No"} |`);

  const s = structuralJson as Record<string, unknown>;
  if (s.fee) lines.push(`| **Fee** | ${s.fee} |`);
  lines.push(``);

  // Resolved inputs (enriched with on-chain data)
  if (resolvedInputs.length > 0) {
    const spendInputs = resolvedInputs.filter((i) => !i.isReferenceInput);
    const refInputs = resolvedInputs.filter((i) => i.isReferenceInput);

    if (spendInputs.length > 0) {
      lines.push(`### Inputs (${spendInputs.length})`);
      lines.push(``);
      for (const input of spendInputs) {
        const tokens =
          input.tokens.length > 0 ? ` + ${input.tokens.length} token(s)` : "";
        const datum = input.inlineDatum ? " (has inline datum)" : "";
        lines.push(
          `- \`${input.txHash.slice(0, 16)}...#${input.index}\` — ${input.ada} ADA${tokens}${datum}`,
        );
        lines.push(`  - Address: \`${input.address.slice(0, 50)}...\``);
      }
      lines.push(``);
    }

    if (refInputs.length > 0) {
      lines.push(`### Reference Inputs (${refInputs.length})`);
      lines.push(``);
      for (const input of refInputs) {
        const tokens =
          input.tokens.length > 0 ? ` + ${input.tokens.length} token(s)` : "";
        lines.push(
          `- \`${input.txHash.slice(0, 16)}...#${input.index}\` — ${input.ada} ADA${tokens}`,
        );
        lines.push(`  - Address: \`${input.address.slice(0, 50)}...\``);
      }
      lines.push(``);
    }
  }

  // Structural: cardano-cli output as fenced JSON
  lines.push(`### Full Transaction (cardano-cli)`);
  lines.push(``);
  lines.push(`<details><summary>Click to expand</summary>`);
  lines.push(``);
  lines.push("```json");
  lines.push(JSON.stringify(structuralJson, null, 2));
  lines.push("```");
  lines.push(``);
  lines.push(`</details>`);
  lines.push(``);

  // Semantic diff
  if (semanticDiff && semanticDiff.changes.length > 0) {
    lines.push(`---`);
    lines.push(``);
    lines.push(`## On-Chain Diff: ${semanticDiff.commandType}`);
    lines.push(``);

    const added = semanticDiff.changes.filter((c) => c.type === "added");
    const removed = semanticDiff.changes.filter((c) => c.type === "removed");
    const unchanged = semanticDiff.changes.filter(
      (c) => c.type === "unchanged",
    );

    const oldCount = removed.length + unchanged.length;
    const newCount = added.length + unchanged.length;
    lines.push(`**Count: ${oldCount} -> ${newCount}**`);
    lines.push(``);

    if (added.length > 0) {
      lines.push(`### Added (${added.length})`);
      lines.push(``);
      for (const c of added) {
        lines.push(`- ${c.description}`);
        if (c.detail) {
          for (const [k, v] of Object.entries(c.detail)) {
            lines.push(`  - \`${k}\`: \`${v}\``);
          }
        }
      }
      lines.push(``);
    }

    if (removed.length > 0) {
      lines.push(`### Removed (${removed.length})`);
      lines.push(``);
      for (const c of removed) {
        lines.push(`- ${c.description}`);
        if (c.detail) {
          for (const [k, v] of Object.entries(c.detail)) {
            lines.push(`  - \`${k}\`: \`${v}\``);
          }
        }
      }
      lines.push(``);
    }

    if (unchanged.length > 0) {
      lines.push(`<details><summary>Unchanged (${unchanged.length})</summary>`);
      lines.push(``);
      for (const c of unchanged) {
        lines.push(`- ${c.description}`);
      }
      lines.push(``);
      lines.push(`</details>`);
      lines.push(``);
    }
  }

  return lines.join("\n");
}

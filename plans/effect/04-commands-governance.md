# Phase 04 — Governance transaction builders

Goal: the commands that build (and optionally submit) governance
transactions, one commit each; shared code in `lib/change-multisig.ts`
moves first.

| Step | Command(s) | Lines |
|---|---|---|
| 1 | `lib/change-multisig.ts` | 444 |
| 2 | `change-council`, `change-tech-auth`, `change-federated-ops` | 707 |
| 3 | `change-terms` | 510 |
| 4 | `register-gov-auth`, `register-cnight-mint-logic` | 238 |
| 5 | `mint-staging-state` | 410 |
| 6 | `stage-upgrade`, `promote-upgrade` | 1000 |
| 7 | `migrate-federated-ops` | 341 |
| 8 | `merge-utxos` | 335 |

Shared shape: `Effect.gen` that resolves UTxOs (`Provider`), builds with
Blaze (`Effect.tryPromise` → `TxBuildError`), completes (`complete-tx`),
then either writes the tx file or submits (`submit.ts`). `--dry-run`
paths become `Effect.when`.

The `[datum-versions] logic_round … falling back` warning seen in
`bun test` today becomes a structured `Effect.logWarning` with fields and
is asserted once in a test.

## Acceptance
- Emulator tests for each command (`tests/change-*.test.ts`,
  `stage_*`, `promote`, `migrate_*`) pass through the phase 06 runtime
  helper; outputs match goldens.

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

## Builder extraction (the testable seam)

Today only `buildMultisigChangeTx` (`lib/change-multisig.ts`) is an
exported builder; `stage-upgrade`, `promote-upgrade` and `merge-utxos`
build their transaction inside `handler(argv)`, so no test can call it and
the emulator tests hand-mirror the logic. As each step lands, split the
command into:

- `lib/<name>-tx.ts`: `build<Name>Tx(inputs, params): Effect<TxBuilder, TxBuildError>`
  — pure over already-resolved UTxOs and datums, no provider, no I/O.
  Step 1 keeps `buildMultisigChangeTx`; step 6 adds `buildStageUpgradeTx`
  and `buildPromoteUpgradeTx` (both two-stage fields, both authorities);
  step 8 adds `buildMergeTx`.
- `program(argv)`: resolve inputs through `Provider`, call the builder,
  complete, write or submit.

The tests that today hand-build these transactions switch to the builder
in the same commit (see phase 06 step 4): `mainnet_upgrade_transactions`
(stage/promote against the mainnet snapshot), `tech_council_upgrade`,
`stage_auth_all`, `mainnet_merge_transactions`,
`change-council-duplicate-signers`, `change-terms-cli`,
`migrate_federated_ops`. A test that still hand-builds after its command's
step is a defect of that step.

The `[datum-versions] logic_round … falling back` warning seen in
`bun test` today becomes a structured `Effect.logWarning` with fields and
is asserted once in a test.

## Acceptance
- Emulator tests for each command (`tests/change-*.test.ts`,
  `stage_*`, `promote`, `migrate_*`) pass through the phase 06 runtime
  helper; outputs match goldens.

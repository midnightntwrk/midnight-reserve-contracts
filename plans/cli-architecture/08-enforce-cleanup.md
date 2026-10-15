# Phase 08 — Enforce the boundaries, remove the old path

## Tasks

1. Delete what the ports left behind: `buildTx`, `completeBuilder` (if
   only `compile` uses it, make it private), the `TxBuilder`-taking
   helpers in `tx/scripts.ts`; rename the `plan*` fragments to the old
   names (`mintWitnesses`, `withdrawThroughLogic`, `registerScriptStake`).
2. `Provider.blazeFor` is read only in `tx/compile.ts`.
3. Lint gate (`eslint.config.js`): the index dependency rules as
   `no-restricted-imports` blocks per folder, and
   `MemberExpression[property.name='blazeFor']` in `no-restricted-syntax`
   outside `cli/tx/**` and `cli/chain/provider.ts`. In flat config a later
   block's options replace an earlier block's for the same rule, so every
   per-folder block repeats the existing `fs`/`child_process` bans from a
   shared constant. Probe file with one violation per rule, refused, then
   deleted (as the effect plan did for its gate).
4. README "how to add a command": resolve → `plan*` → `compile` →
   `signAndWrite`, with the dependency rules table.

One commit per task.

## Acceptance

- `grep -rln "TxBuilder" cli` lists only `cli/tx/`.
- `grep -rn "Blaze<" cli` lists only `cli/tx/` and `cli/chain/provider.ts`.
- Lint gate refuses the probe file; `just check` green.
- Build-only QA on preview for every transaction command (no
  `sign-and-submit`): same file shape and output lines as before the plan.

## Deviations

- Task 1: the `TxBuilder`-taking helpers in `tx/scripts.ts` and
  `registerScriptStake` were already gone (phases 05 and 07), and no
  registration fragment exists: registration is the plan's `registrations`
  field. Only `planMintWitnesses` → `mintWitnesses` and
  `planWithdrawThroughLogic` → `withdrawThroughLogic` were renamed.
- Task 1: `completeBuilder`, `completeChecked` and `Completion` are private
  to `tx/compile.ts` (compile was the only caller of the last two once
  `tx/complete-tx.ts` went). `tests/deploy.test.ts`'s size-check and labels
  tests now go through `compile` over `emulatorProgram`; the size test sets
  `emulator.params.maxTxSize` to the unsigned size, so the provider's
  parameters carry the limit. The assertions are unchanged, except that
  both transactions now carry the local UPLC evaluator, as every compiled
  transaction does.
- Task 1: `tx/labels.ts` keys its UTxO lookup by a private `txId#index`
  string instead of `refOf` from `chain/utxo`, so `tx/**` no longer imports
  `chain/utxo` (which reads `config/**` and `governance/**`).

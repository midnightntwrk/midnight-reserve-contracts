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
- Task 2: nothing to change in `cli/`. Since phase 07 `blazeFor` is read
  only in `tx/compile.ts` and defined in `chain/provider.ts`
  (`grep -rn blazeFor cli`). `tests/deploy.test.ts` still calls it once, to
  test the Provider's GuardedWallet coin selection; the lint rule of task 3
  covers `cli/**` only.
- Task 3: the dependency rules are not per-folder `no-restricted-imports`
  blocks. A rule such as "imported only by `deploy/**`" depends on the
  importer, and a later flat-config block replaces an earlier one, so
  overlapping folder blocks would drop each other's rules. `eslint.config.js`
  holds the rules as `forbids(from, to)` predicates over module paths
  (`BOUNDARIES`) and generates, for each `cli/` module that breaks one, one
  block whose `paths` are the exact specifiers of the forbidden modules
  (`./config/keys`, `../config/keys`, …) after the shared `fs` /
  `child_process` list. Each message names its rule. The `blazeFor` rule is
  a separate block over `cli/**` minus `cli/tx/**` and
  `cli/chain/provider.ts`; it repeats the `ThrowStatement` and
  `TryStatement` selectors and also refuses `{ blazeFor }` destructuring.
- Task 3: the rules enforce the table's "must not import" column, with
  these differences, all in the index table too. `config/keys` and
  `config/provider-config` are also imported by `run.ts`, which builds their
  layers, and `provider-config` by `chain/registration`, a Blockfrost read
  beside `chain/blockfrost`. `tx/**` may import `datum/**` (`tx/scripts`
  takes `Signers`), and `chain/**` only through `chain/provider`
  (`tx/labels` no longer imports `chain/utxo`, see task 1).
- Task 3: "a command's `plan*` imports no effect services" is enforced only
  for `deploy/builders`, the one module that holds nothing but plans. Plans
  elsewhere share a file with their `resolve*` and program (`governance/*`,
  `wallet/*`), so a per-module import rule cannot separate them; they stay
  checked by review and by the plans' pure signatures. The `effect` package
  itself cannot be refused: plans use `Option`.
- Task 3: the rules cover imports written as module specifiers. A dynamic
  `import()` or an import through a re-export is not covered; `cli/` has no
  re-exports (phase 01 rule).
- Task 3: probe, run once and deleted. One file per folder (`cli/tx/`,
  `cli/signing/`, `cli/governance/`, `cli/contracts/snapshot/`) with one
  violation per rule, plus the leaf rule and the pure-plans rule appended
  to `snapshot/context.ts` and `deploy/builders.ts` and reverted. `bun run
  lint` refused 18 lines: `no-restricted-imports` for the `fs` ban, the
  `tx/**`, `deploy/builders`, `signing/**`, `config/keys`,
  `config/provider-config`, `snapshot/write`, `snapshot/read`,
  `snapshot/storage`, `bindings`, `build-engine`, leaf and no-output rules,
  and `no-restricted-syntax` for `provider.blazeFor` and `{ blazeFor }`.
  `import "../chain/provider"` from `tx/` passed.
- Task 4: the existing "Adding a command" text had no `build*Tx` wording
  and its `withServices` text is still right, so it stays; the new section
  follows it. The transaction file's fields are `description`, `cborHex`,
  `txHash`, `signed` (`signing/tx-file.ts`), not `txId`.

## Build-only QA on preview (2026-10-15)

Every transaction command was run with `-n preview -o <dir>` (no `--sign`;
governance commands with `--no-sign`; no `sign-and-submit`) from this
branch and from the `cli/04-effect` commit, over the same preview state
(deployer fee UTxO `8fdf3058…#1`, ICS forever UTxOs `c07f78d3…#0`/`#1`).
For each run the output lines and the transaction file (`txHash`,
`cborHex`, `signed`, `description`) were compared.

- Built, file equal to the baseline's (same `txHash` and `cborHex`):
  `merge-utxos` (ICS #0 + #1), `change-council`, `change-tech-auth`,
  `change-federated-ops`, `change-terms`, `mint-tcnight` (mint 100),
  `simple-tx` (2 × 5 ADA), `stage-upgrade` (federated-ops, tech-auth,
  council with `--use-build`), `promote-upgrade` (council, tech-auth,
  federated-ops, reserve, ics, terms-and-conditions).
- Refused identically by both, with the same message: `deploy` (every
  component: the profile's one-shot `b585c885…#15` is not at the deployer
  any more; `cnight-minting` is not in the preview blueprint),
  `deploy-staging-track` (no staging forever in the preview build),
  `migrate-federated-ops` (active logic is still v1),
  `mint-staging-state` (no v2 logic in the build; no staging forever for
  federated-ops), `register-gov-auth` (already registered),
  `register-cnight-mint-logic` and `run-cnight-mint-mainnet` (no cNIGHT
  contracts in the preview blueprint, with or without `--use-build`).
- Output lines differ in one way: a `Building transaction...` line before
  the local UPLC lines in the commands that did not print it before. That
  is the previous commit's change ("compile prints it for every command"),
  not this phase's. The `stage-upgrade` refusal for an unknown hash names
  the workspace path of the build, which differs by workspace only.
- Not reachable on preview: `deploy`, `deploy-staging-track`,
  `migrate-federated-ops`, `mint-staging-state`, `register-gov-auth`,
  `register-cnight-mint-logic` and `run-cnight-mint-mainnet` build no
  transaction from current preview state, so no preview build of them was
  compared.

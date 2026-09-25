# Phase 06 — Tests

Goal: tests exercise functions (builders with `expectValidTransaction`,
lib functions), never a command program; the whole command is manual QA
on preview (user decision 2026-09-26). Helpers are layers; bun:test stays.

Done 2026-09-26: `tests/deploy.test.ts`, `tests/deploy-staging-track.test.ts`
and `tests/mint-tcnight.test.ts` no longer run `deployProgram`,
`deployStagingTrackProgram` or `mintTcnightProgram`. What those tests
checked is now tested on the function that owns it: the deploy steps
against `DEPLOY_COMPONENT_VALIDATORS` and their threshold datums
(`DEPLOY_STEPS`), `selectTransactions`, `snapshotKindOf` and
`snapshotRuleOf`, `resolveUnspent`, `resolveCollateral`, the six
`STAGING_STEPS` through the builder, `burnAction`, `addressOn`, and the
mint-tcnight builder outputs. The program orderings (the snapshot before
any chain call, the snapshot before the file) are not tested.

Done 2026-09-26 (the rest): no test runs a command program; `grep
'Program(' tests/` finds only the `emulatorProgram` helper. Per file:
- `generate-key`: `keyToAddress` against a cardano-cli 10.14 vector.
- `dust-participants`: the preview program run goes; `dustUtxos` is a
  pure test.
- `info-golden`: goes (a whole command's stdout).
- `simple-tx`, `effect-tx`, `emulator-confirmation`: `buildSimpleTx` through
  `expectValidTransaction`; `signAndSubmitOne` signs and submits and
  `confirm` follows; `submitTx` refuses an unsigned transaction once. The
  shared `unsignedSimpleTx` helper builds over the Provider.
- `combine-signatures-cli` → `combine-signatures`: `readWitnessFile` (each
  witness form; each malformed or unverified one refused, naming the file),
  `mergeWitnesses`, `readSingleTransaction`.
- `governance-programs`: goes. The builders are covered in
  `change-multisig` and `change-terms`; `signerFor` and `signAndWrite` in
  `effect-output`; the codec fallback warning on `codecFor`.
- `change-federated-ops`: `requireMigratedDatum`, extracted from the program.
- `migrate_federated_ops`, `merge-utxos-cli`, `mint-staging-state`,
  `two-stage-upgrade-cli`: the program tests go; the builder tests cover
  them (`merge-utxos-cli` and `two-stage-upgrade-cli` are deleted).
- `register-stake`: the program tests go; on preview `refuseRegistered` and
  `ensureRegistered` are tested directly.

## Tasks

### 1. Goldens before any port (first commit of the whole migration)
For `info`, `verify`, `deploy --dry-run`, `simple-tx`: capture stdout and
written files against the emulator snapshot into
`tests/golden/<command>/`. Ports must reproduce them.

Recorded 2026-09-25: `deploy` has no `--dry-run`, and no test reads
`tests/golden/deploy/`. It holds the preview stdout of the 2026-09-24
deployment (a full run and four runs of the since-removed `--name`); the
preview one-shots are spent, so it cannot be reproduced. It stays as
reference output for deployment comparisons, not a test (user decision
2026-09-25). The deploy command itself is manual QA on preview.

Closed 2026-09-26: the offline `verify` and `dust-participants` goldens
(plans 03 and 08) would test a whole command's stdout, which is manual QA
now. The `verify` goldens are gone with the verify rewrite (plan 03): its
checks are pure functions over the record and the unspent outputs, tested
in `tests/verify.test.ts` on the preview record. The reference outputs
under `tests/golden/` (deploy, info, dust-participants, register-gov-auth,
the simple-tx stdout) were deleted 2026-09-26; jj history keeps them.
`tests/effect-output.test.ts` and `tests/combine-signatures.test.ts` read
the one golden left, the simple-tx transaction, as data.

### 2. `tests/helpers/effect.ts` (done)
As built:
```ts
export const runTest = (layer, effect) => Effect.runPromise(Effect.provide(effect, layer));
export const EmulatorLive = (emulator: Emulator, capture: OutputCapture, env: Environment = "emulator") =>
  Layer.mergeAll(SettingsOver(env), BlueprintLive(env, "build"), ProviderEmulator(emulator, env),
    OutputCaptured(capture), LoggerCaptured(capture), PlatformLive, DeployedScriptsTemp);
export const expectFailure = (layer, effect, tag) => ...   // returns the tagged error, no string matching
```

### 3. Helpers as layers (done)
`tests/helpers/deploy.ts` (`deployTechAuth`, `deployCouncil`, …) and
`upgrade.ts` return `Effect`s requiring `Provider`; `mainnet-snapshot.ts`
stays data.

Recorded 2026-09-25: neither file exists. Phase 05 step 1 deleted
`tests/helpers/deploy.ts`: the tests call the CLI deployment builders
(`cli/deploy/builders.ts`) and the deploy steps directly. There is no
`upgrade.ts`; `tests/helpers/` is `effect.ts`, `fixtures.ts` and
`mainnet-snapshot.ts`.

### 4. Port by import
Tests that import only pure lib modules (`cli/datum/signers.ts`,
`cli/datum/datum-versions.ts`, `cli/contracts/versions.ts`,
`cli/input.ts`) change to `Either`/`Effect.runSync` in phase 02. Emulator
tests move with their command in phases 03–05 and, in the same commit,
stop hand-building the transaction: they resolve the snapshot or seeded
UTxOs, call the command's `build<Name>Tx` from its `cli/` domain module, and run
`expectValidTransaction`. The assertion then covers the CLI builder and
the validator together; shape asserts against the test's own inputs are
not added back. `tests/bridge/**` is already independent of the CLI and
does not change.

Negative twins come with the builder: for each builder one test passes a
wrong input (missing second-authority witness for council/tech-auth,
stale staging round for promote, a merge output that drops cNIGHT) and
pins the withdrawal or spend failure text. The emulator does not evaluate
native-script signers, so witness tests assert the validator's rejection,
not signature satisfiability.

Done: the deploy builders' negative twins (`lwymnnpx`: a two-stage, a
threshold and a staging forever deployment over a UTxO that is not their
one-shot, in `tests/deploy.test.ts` and
`tests/deploy-staging-track.test.ts`).

Done 2026-09-26: `buildSimpleTx` is exported and tested with
`expectValidTransaction`; `buildTermsChangeTx` has a positive test that
reads the new hash and link from the ledger. Negative twins: a merge output
that drops cNIGHT for another asset (`mainnet_merge_transactions`); the
ledger refusing a credential it already holds, for each register builder
(`register-stake`); a second MitigationLogic promote
(`mainnet_upgrade_transactions`).

Not done, with the reason:
- A stale staging round for promote has no twin: the two-stage validator
  copies the staged field and its round with no freshness check
  (`promote_staging_field_to_main` in `lib/upgradable/two-stage-upgrade.ak`),
  so a stale round is not a rejection. The twin added is the
  set-once rule of the mitigation fields.
- `tests/cnight-minting.test.ts` (~L104, `mintTx`) still hand-builds the
  cNIGHT mint through the minting proxy: no CLI command builds it
  (`deploy-cnight-minting` and `run-cnight-mint-mainnet` were deleted in
  plan 09 task 0), so there is no builder to call.

### 5. Error assertions
Replace `rejects.toThrow()` / message regexes with `expectFailure(eff,
"UtxoNotFound")`. Every tagged error class has at least one test that
produces it.

Done 2026-09-26: `TxBuildError` (the size check, `deploy.test`),
`AikenBuildError` (`keepsPins`, `build-engine.test`) and
`StakeNotRegistered` (`ensureRegistered`, preview mode only: locally every
account counts as registered) each have a test. Since plan 07 task 3c,
`keepsPins` yields `PinsMoved`, so no test yields `AikenBuildError`. `VerificationFailed` has
none: only the verify program yields it, and the program is manual QA; its
checks are pure functions over the record and the unspent outputs, tested
in `tests/verify.test.ts` (the verify rewrite, `sltxmtvz`).

Closed by plan 07 task 3c (2026-09-26): the refusals assert their
`Refusal` fields, and `LiveRecordMismatch` and `PinsMoved` their moved
hashes. The text asserts left (18 by a grep on 2026-09-26) are on
`ConfigError`, `BlueprintError`, `AikenBuildError`, `DatumParseError` and
`InputParseError`, whose message is the data (a parse or config message),
by the 07 task 3c decision.

## Acceptance
- No `try`/`catch` in `tests/**` except inside `expectFailure` and
  `tests/bridge/**` (`tests/bridge/reference/mmr.ts` is a reference
  implementation).
- `bun test` runtime not more than 1.5× today's (3.9 s).
- The local tests reach no network. `tests/blockfrost.test.ts` and
  `tests/effect-tx.test.ts` connect to `127.0.0.1:9` (loopback only) to
  get a refused connection.

Checked 2026-09-26: no `try`/`catch` statement in `tests/**` outside
`tests/bridge/**` (`expectFailure` reads the `Exit`); the local tests reach
only the loopback. Runtime, local mode on the same machine: 4.94 s
(408 pass, 12 skip) before this sweep, 4.29 s (400 pass, 11 skip) after;
the budget is 5.85 s (1.5 × 3.9 s).

Phase 06 is done except the reason and issues text asserts, which move
with plan 07 task 3c.

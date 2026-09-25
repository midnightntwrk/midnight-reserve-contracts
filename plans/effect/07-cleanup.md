# Phase 07 — Cleanup

The `@effect/cli` decision moved to phase 09 (decided: yes).

## Tasks
1. Done in phase 05 step 3: the lint gate covers all of `cli/**` with no
   exemption; `cli/` has no `throw new Error`, no try/catch statement, no
   `process.env`, sync fs, `child_process` or `console` (the grep is
   clean; the gate itself is task 3d, done).
2. Done in phase 05: each Promise/throw export went with its last caller
   (`orThrow`, `completeTx` and `TransactionBuildError`, `createProvider`,
   `getEnvVar`, `getContractInstances`, the print and write helpers).
3. Done in the phase 05 review 2: the snapshot reads and writes go
   through the `DeployedScripts` service (`cli/contracts/versions.ts`):
   deploy, `stageValidator`, `promoteValidatorVersion`, `readVersions`,
   `validatorNameByHash`, `mergeValidatorIntoDeployed`,
   `buildFromDeployed` and `verify`'s plutus.json. `EmulatorLive` provides
   a scoped temporary root, so no test writes the repository's
   `deployed-scripts/`. Deviation: the generated deployed blueprint
   modules still load from the repository by static `require`
   (`cli/contracts/contracts.ts`); they are read-only.
   Done 2026-09-26: `signAndWrite` takes the `Signer` (its key groups,
   resolved by `signerFor` before any chain access) and prints the one
   success line itself (no caller adds its own); change-terms and
   change-federated-ops are `buildGovernedForeverUpdateTx`
   (`cli/governance/governed-forever.ts`) with their own datum; the
   `signAndWrite` test asserts the written witnesses, not output lines.
3b. Done 2026-09-26 (from the phase 05 review 2 guardrail audit, each
   fixed at its boundary): `SIGNING_PRIVATE_KEY` and the `*_PRIVATE_KEYS`
   are parsed in Settings into `PrivateKey` (64 hex, `parsePrivateKeys`,
   a reason that never quotes the key), so `signTransaction` cannot throw
   and the `Either.try`/`Effect.try` at `sign-and-submit` and
   `combine-signatures` are gone; `validatorLabels` is a pure function
   over the draft transaction and the `contracts` listing of the Blueprint
   service in context (a command with no blueprint, `simple-tx`, labels
   nothing); `settings.ts` and `build.ts` resolve from `PROJECT_ROOT`; the
   teardown no longer exits on success (the Ogmios socket closes with the
   Provider layer, so no handle holds the process) and gives code 1 to
   runMain on failure, so `cli/` has no `process.exit`;
   `currentGitCommit` was already gone with `gitCommit`; an optional
   blueprint class that is present must construct (`contracts.ts`).
3c. Done 2026-09-26: errors carry data (index guardrail).
   `PreconditionFailed` carries a `Refusal` union (`Promoted` with the
   environment and the names, `CollateralTooSmall` with the lovelace, the
   requirement and its inputs, `NightTooLow` with held and required,
   `DatumNotMigrated` with both rounds, `LogicNotV2` and
   `MitigationActive` with the hash, `NoCnight` with the asset,
   `AlreadyRegistered` with the environment and the scripts,
   `DatumAlreadyMigrated`), rendered once in `renderError` with the same
   text as before. `--provider blockfrost` off a Cardano network is
   `BlockfrostUnavailable { environment }`, checked where `ProviderLive`
   is built. A Blockfrost GET names its path only in `op`; the cause no
   longer repeats it. The refusal tests assert the refusal fields. The
   `reason` of `ConfigError`, `BlueprintError`, `AikenBuildError`,
   `DatumParseError` and the `issues` of `InputParseError` stay text: for
   those classes the message is the datum (a parse or config message), and
   their tests keep asserting it. The live-record check and the moved-pin
   check are their own classes: `LiveRecordMismatch { environment, moved,
   components, path }` and `PinsMoved { moved }`, each `moved` entry the
   validator with its deployed and built hash; the printed text is the
   same as before (user decision 2026-09-26, replacing a recorded
   deviation).
3d. Done 2026-09-26: the lint gate enforces task 1 (`eslint.config.js`).
   `cli/**` bans every `try` statement, `throw`, `console`, the `fetch`
   and `Bun` globals, `fs`/`fs/promises`/`child_process` imports (with or
   without `node:`), `process.exit`, `process.env`, `Effect.promise` and
   every `Effect.run*`; `tests/**` bans `try` outside `tests/bridge/**`
   and `Effect.run*` outside `tests/helpers/effect.ts` and
   `tests/effect-output.test.ts`. It flagged nothing: the earlier phases
   had already removed each. A probe file with one of each was refused.
3e. Done 2026-09-26, from the preview QA and the review: mint-staging-state
   finds its one-shot and collateral with `resolveUnspent` and
   `resolveCollateral` (Blaze's Blockfrost `resolveUnspentOutputs` also
   returns spent outputs; the collateral size is checked too); a generated
   blueprint module that is not there is a `BlueprintError` naming the
   remedy (`no build output for local; build it first: just build
   local`); the register-stake twins submit without the emulator's
   "Script Bytes" dump.
3f. Review fixes, 2026-09-26: the size check counts the vkey witnesses a
   transaction carries at submit (`witnessCount`: every key of a signed
   file, or the required multisig signatures of an unsigned one, and the
   deployer's at sign-and-submit; 101 bytes each, `sizeAtSubmit`), checked
   against a really signed transaction in the test; `simple-tx --to`
   refuses a reward (stake) address; verify checks cNIGHT minting where
   versions.json promotes `cnight_mint_forever`, requires each UpgradeState
   mitigation logic and mitigation auth to be empty or in the record, and
   takes a track's logic as `<track>_logic` or `<track>_logic_v<N>` for any
   N from 2 up (user decision: logic names are `_vN`, and promoted grows
   forever); the combine-signatures refusal tests tell the refusals apart
   by their issue. Left v2-specific because config drives them: the
   aiken.toml `*_logic_v2_one_shot` keys, `V2_TRACK_VALIDATORS` and the v2
   logic classes of mint-staging-state, and the federated-ops v2 datum
   format of migrate-federated-ops.
4. Done 2026-09-26: structured logs were phase 08 (Console for output,
   `Effect.log*` for diagnostics); README "Logs" documents `LOG_LEVEL` and
   the `--log-level` built-in, which wins over it for one run.
5. Closed 2026-09-26 with no new docs (user decision): the code and the
   module docstrings are the developer docs; README keeps how to add a
   command.
6. Stays with the user (carried from plan 05): the mainnet
   `versions.json` does not list the six `*_staging_forever` validators its
   `plutus.json` holds. A mainnet extend (the bridge, any `--components`
   run) checks the build against the record, so the operator adds them to
   `promoted` by hand in `deployed-scripts/mainnet/` before that run.
   Since 2026-09-26 `deploy-staging-track` extends the snapshot with the
   staging forevers it creates (the preview QA found the record stale
   after phase 2), so the hand edit is only for the mainnet record made
   before that.

## Acceptance

Met 2026-09-26; phase 07 is done (task 6 is the operator's edit).
- `grep -rc "throw new Error\|catch {" cli | grep -v ':0'` is empty, and
  the lint gate (task 3d) refuses any `try`, `throw` or runner in `cli/`.
- `info` on all 8 environments (2026-09-26): preview, qanet, govnet,
  devnet, preprod and mainnet ran from their deployed scripts; the
  emulator has none and ran with `--use-build`; local has no build output
  until `just build local`, and now says so (task 3e).
- The v2 upgrade QA on preview (2026-09-26, the v2 logic validators are
  always-true stubs): register-gov-auth `6a7453de`; federated-ops stage
  `cd18a607`, promote `9661ba3e`, migrate `f192a7e6`; ICS
  mint-staging-state `c5e77723`, stage `33d66342`, promote `602bdd18`;
  the phase 4 downgrade of ICS to v1, stage `fa1f684b`, promote
  `a6d6232f`; the phase 5 combine-signatures change-council `10f15d58`
  (six cardano-cli 10.14 witnesses); an ICS re-deploy `3d202065` after
  simple-tx `632ef193`; `verify` passed all 42 checks.

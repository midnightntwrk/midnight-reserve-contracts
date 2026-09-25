# Phase 05 — Deploy family and signing

Goal: the largest and most sensitive commands last, with the most
tested lib beneath them.

| Step | Command(s) | Lines | Notes |
|---|---|---|---|
| 1 | `deploy` | 1217 | split into `deploy/steps/*.ts`, one `Effect` per contract; `Effect.all` sequential with `Effect.tap` progress lines; the order and the output JSON unchanged |
| 2 | `deploy-staging-track` | 564 | reuse the steps |
| 3 | `mint-tcnight` | 248 | mainnet paths need `Config` env guards as typed errors |

Changed by the 2026-09-25 restructure (plan 09 task 0):
`deploy-cnight-minting` and `run-cnight-mint-mainnet` are deleted (no
runbook, script or doc used them; the jj history keeps them).
`sign-and-submit` and `combine-signatures` are ported onto
`submitTx`/`awaitConfirmation` in that restructure, not here; the
hand-written `submitWithRetry` loop goes with them. Never run either
against a network (guardrail). Done in `lnryvmtu` (sign-and-submit),
`xwrlozum` (combine-signatures) and the following commit (the
hand-written loop, `printProgress`, `isSingleTransaction` and
`isDeploymentTransactions` deleted). Accepted differences: a failure
reason is the rendered CliError (`Submission failed after 3 attempt(s)
(…): …`), retry notices go to the log on stderr, a command with a failed
transaction ends with one `❌ Submission failed: <command>: N
transaction(s) failed` line (a SubmitError) after the summary, and an unreadable or malformed file is an
`InputParseError` instead of a thrown error.

## Step 1 as built (deploy)

- Deviation from the table: no `deploy/steps/*.ts` and no progress
  lines. `cli/deploy/builders.ts` holds three pure builders
  (`buildTwoStageDeploymentTx`, `buildThresholdDeploymentTx`,
  `buildStagingForeverDeploymentTx`) over resolved inputs: the four
  two-stage deployments of the old handler (multisig, simple,
  federated ops, terms and conditions) called the builder methods in the
  same order and differ only in the forever datum and mint redeemer and in
  whether the logic stake is registered (reserve and ICS do not). Blaze
  orders the witness scripts by requirement, not by `provideScript`, so
  one builder keeps the transaction bodies. `DEPLOY_STEPS` in
  `cli/deploy/deploy.ts` maps each of the twelve transactions to its
  component and build. `Effect.forEach` builds them in order through
  `completeBuilder` (`cli/chain/complete-tx.ts`: buildTx's completion
  with no output), so stdout keeps the old lines: no per-transaction
  line was printed before. `cli/deploy/deployment.ts` has what
  deploy-staging-track reuses: the collateral check, the script outputs
  of a built transaction (a script payment credential or a token, not the
  bech32 prefix test), the header and the report.
- Parsed at the boundary: the four
  thresholds (`parseThreshold`, fallback their env values: 2/3, 2/3, 0/1,
  1/2), `--components` (`parseNameList`: blanks dropped, `all` alone or
  nothing is every component, `all` with other names or an unknown name is
  refused; superseded: `all` was removed in review 2, see "Deploy vs
  upgrade"), `--name` (a choice over the twelve names; superseded:
  removed in `lmpsomsx`). The initial terms
  and conditions come from `Settings.initialTermsAndConditions`
  (`TERMS_AND_CONDITIONS_INITIAL_HASH` is now checked as 32 bytes of hex).
  The collateral is a `UtxoNotFound` or a `PreconditionFailed`; a build
  failure is a `TxBuildError` for `deploy/<name>`.
- The snapshot: the Effect `saveDeploySnapshot` (`versions.ts`) replaces
  the sync one, same rule (merge by title, promoted = union; replaced by
  the snapshot rule and then the deploy vs upgrade decision below). It reads
  `plutus-<profile>.json` and `contract_blueprint_<profile>.ts` (the
  carried path bug below is fixed here), and runs only for an environment
  with deployed scripts, so local and the emulator never write
  `deployed-scripts/`. A failure is still the `Note: Could not save
  deployment scripts` line (superseded: a failed save fails the command,
  see "Deploy vs upgrade"). The rule change the user decided on
  2026-09-25 is its own commit.
- The pre-Effect getters with no caller left go: the four threshold
  getters, the terms-and-conditions getters, `saveVersionSnapshot` and
  its sync helpers.
- Tests: `tests/deploy.test.ts` replaces `basic_deploy`,
  `deploy_thresholds`, `federated_ops_deploy` and `tests/helpers/deploy.ts`:
  the builders over the default profile's build contracts and one-shots
  (`expectValidTransaction`), and `deployProgram` on a seeded emulator
  (the twelve transactions in order, the file, `--components`, `--name`
  replacing in and creating a file (superseded: `--name` was removed in
  `lmpsomsx`), the collateral refusals).

## Step 2 as built (deploy-staging-track)

- The six staging forever steps (`STAGING_STEPS`) build through
  `buildStagingForeverDeploymentTx` and `buildTx` with the one-shot and
  the collateral as known UTxOs, as the old `completeTx` call did, so the
  local UPLC lines stay. It shares the collateral check, the transaction
  selection (`selectTransactions`), the zero forever datum, the federated
  ops datum (`initialFederatedOpsDatum`, which replaces the pre-Effect
  `createFederatedOpsDatum`) and the report with deploy. A staging
  forever validator missing from the blueprint is a `BlueprintError`, not
  a `!`. `PERMISSIONED_CANDIDATES` is read only when the federated ops
  step runs (it was read before any step). `--name` still writes the file
  with the one transaction (no merge, as before; superseded: `--name` was
  removed in `lmpsomsx`).
- Accepted difference: the report prints the blank line after each
  transaction's script outputs that deploy prints; `--components` takes
  the shared list rule of deploy.
- Old versus new on preview (the staging one-shots build locally): all
  six transactions of `deploy-staging-track -n preview` are identical,
  txHash and cborHex; stdout differs by those six blank lines.
- The pre-Effect exports with no caller left go: `getDeployUtxoAmount`,
  `getDeployerAddress`, `loadAikenConfig`, `createBlaze`,
  `signersFromEnv`, `createMultisigStateCbor`, `createRedeemerMapCbor`,
  `createDeploymentOutput`, `printTransactionSummary`, `printInfo`.

## Step 3 as built (mint-tcnight)

- `mintTcnightProgram` over typed input: `--amount` positive
  (`parsePositiveBigInt`, the renamed `parseLovelace`), `--user-address`
  and `--destination` bech32 at the boundary and on the environment's
  network in the program (`addressOn`, an `InputParseError` naming the
  option). The mainnet guard is by construction: `--network` is
  `testNetwork`, a choice over `TEST_ENVIRONMENTS` (every environment but
  mainnet), so `-n mainnet` is a `ValidationError`. The user's cold
  wallet is Blaze over the Provider (`provider.use("Blaze.from")`).
  `buildMintTcnightTx` is pure over a `TcnightAction` (mint to an
  address, or burn from selected UTxOs with the remainder back);
  `selectBurn` picks the NIGHT-holding UTxOs in order. No NIGHT is an
  `UtxoNotFound`, too little a `PreconditionFailed`, a missing
  `tcnight_mint_infinite` a `BlueprintError`.
- User decision 2026-09-25 (`uxkkvtrq`): `--burn` with `--destination` is
  refused at the boundary (a `ValidationError`, before any service).
  `--burn` and `--destination` parse into one `TcnightRequest` (a mint
  with its destination, or a burn). Before, a burn ignored
  `--destination`.
- Old versus new on preview: `mint-tcnight --amount 1000` and `--burn
  --amount 100` write identical files; the burn's stdout is identical,
  the mint's differs by the local UPLC warning, which is the phase 08
  structured log on stderr (the draft of a mint with no input does not
  decode for the local evaluator, as before).
- The last pre-Effect surface goes: `createProvider`, `getEnvVar`,
  `getContractInstances`, `completeTx` and `TransactionBuildError`,
  `writeTransactionFile`, `writeJsonFile`, `ensureDirectory`, the print
  helpers and `orThrow`; `eslint.config.js` has no exemption left.

## The snapshot rule (user decision 2026-09-25)

Promotion is permanent; an unpromoted validator can be replaced. This
replaces the carried "promoted = validators with a confirmed deployment
transaction; a fresh deployment replaces the snapshot" item.
- Each deploy step names the validators it creates (its two-stage triple
  or its threshold); their names come from their hashes in the build
  `plutus.json`, so promoted lists only what the deploy creates, not every
  base name of the blueprint (the old list had `z_*_types`, the bridge,
  cNIGHT and tcnight).
- `production` in the environment table: `preprod` and `mainnet`. There,
  before any build, `promotedAmong` reads `versions.json`; a selected
  validator already promoted is a `PreconditionFailed` (the check is the
  snapshot, not the chain, by the user's choice: a deploy that was never
  submitted blocks a re-run until `versions.json` is edited). The
  snapshot is extended: a promoted validator keeps its previous entry (and
  one the build lacks is kept), the build's version replaces the rest, and
  the deployed names join promoted; staged is kept. (Superseded by "Deploy
  vs upgrade": an extend takes the build entry only for a deployed title
  and a new title.)
- Every other environment with deployed scripts: the snapshot is replaced
  (plutus.json and the blueprint copied from the build, promoted = the
  deployed validators, staged = []). (Superseded by "Deploy vs upgrade":
  only a full run on a test environment replaces; a `--components` run
  extends.)
- `saveDeploySnapshot` and `promotedAmong` take the snapshot directory, so
  `tests/snapshot.test.ts` runs them on temporary directories.
- Manual QA: `deploy -n mainnet` (with a mainnet `DEPLOYER_ADDRESS` for the
  run) is refused before any build, naming the 24 promoted validators;
  `--name terms-and-conditions-threshold-deployment` names the one.
  Nothing is written. (`--name` was removed later, in `lmpsomsx`.)

## Acceptance
- `tests/deploy.test.ts`, `tests/deploy-staging-track.test.ts`,
  `tests/snapshot.test.ts`,
  `tests/mint-tcnight.test.ts`, `cnight-minting`, `mainnet_*` green.
- `deploy -n preview` proves the flow on fresh one-shots (decision
  2026-09-25: the preview one-shots were spent by the 2026-09-24
  deployment, so `tests/golden/deploy/` cannot be reproduced; the user
  approved the preview submits of that QA). The snapshot of a full run
  is written in a scratch checkout, never the repository's
  `deployed-scripts/`. Done 2026-09-25: `simple-tx -n preview` submitted
  and confirmed (`b5c99f7c…`, 15 × 20 ADA to the deployer; the one
  submit); in two scratch jj workspaces (the pre-port commit `qlsmzqlw`
  and `yxxtpsmz`) the 15 preview main one-shots pointed at it, one `just
  build preview`, then `deploy -n preview`: the twelve transactions are
  identical in txHash and cborHex (completed through Blockfrost, so
  evaluated on chain inputs) and stdout is identical. The old snapshot
  merged and kept the stale hashes (43 promoted names); the new one is the
  build output with the 24 deployed names. `--name council-deployment`
  replaced its entry with the same hash (`--name` was removed later, in
  `lmpsomsx`). The deployment transactions were
  not submitted; the repository's `aiken.toml` still names the spent
  one-shots, and `b5c99f7c…#0..14` are free for the next preview
  deployment.

## Deploy vs upgrade (user decision 2026-09-25, review follow-up)

Deploy sets up contracts that are not live; a change to a live contract
is an upgrade (`stage-upgrade`, `promote-upgrade`), never a deploy. On
`preprod` and `mainnet` every validator of the twelve transactions is
promoted, so every deploy there is refused; a deploy there is only for a
contract that is not live yet (e.g. a future committee bridge). This
replaces the rule choice and the failure note above:
- A full run on a test environment replaces the snapshot. A
  `--components` run, and every run on `preprod` and `mainnet`, extends
  it.
- An extend takes the build entry only for a deployed title (in place)
  and for a title new to the snapshot; every other entry stays. The rule
  alone chooses the branch.
- Every read and the blueprint generation run first, then the four files
  are written; a failure fails the command on every environment (the
  deployment file is already written).
- A deployed hash the build `plutus.json` lacks is a `BlueprintError`.
- The snapshot root is the `DeployedScripts` service (review 2, user
  decision 2026-09-25): the CLI's `BaseLive` names the repository's
  `deployed-scripts/`, the test layers a temporary directory. A deploy's
  snapshot kind comes from the environment table: production (preprod,
  mainnet) first, so a production deploy always has a snapshot and is
  always checked (before, `deployProgram` took an `Option` directory and
  `Option.none()` skipped the check); then test (an environment with
  deployed scripts); else none (local, the emulator).
- One selection flag (user decision): `--name` is removed from `deploy`
  and `deploy-staging-track`; `--components` selects, and the file holds
  only the built transactions, so `sign-and-submit` sends only them (the
  merge of `--name` made `sign-and-submit` send again the transactions
  already on chain). A new validator is deployed through a new
  `DEPLOY_STEPS` entry with its own component.
- `all` goes (user decision 2026-09-25): no `--components` is the full
  run (the default set); `--components <list>` takes at least one known
  name, and an empty list or `all` is refused (`parseNameList` returns a
  non-empty list). Before, `--components ""` or `all` was a full run and
  replaced the snapshot of a test environment. `deploy-staging-track`
  takes the same rule.
- Review 2 (user decisions 2026-09-25):
  - Write order: the snapshot is saved (every read and the generation
    first, then its four files), then the deployment file is written. A
    failed save leaves no file to sign. If only the deployment file write
    fails on preprod or mainnet, a rerun is refused until `versions.json`
    is edited, as for a deploy that is never submitted.
  - `changelog.json`: an extend appends its changes to the ones already
    there (the format is unchanged; `timestamp` and `gitCommit` name the
    last run); a replace starts it again.
  - Definitions: an extend (and `mergeValidatorIntoDeployed`, the
    `stage-upgrade --use-build` path) takes the build definitions that
    the taken entries reach through `$ref`. A definition that a kept
    entry also reaches with another shape (its own title and description
    aside) is a `BlueprintError`, and so is a reference that neither file
    defines. Before, the snapshot's definition won, so a changed type
    kept its old encoding. `rqukovrk` had already changed the
    `stage-upgrade --use-build` output (the build's missing definitions);
    this is its record.
  - `mergeValidatorIntoDeployed` keeps the entry in place (a new title is
    appended) and generates the blueprint before it writes either file.
- Review 2, recorded deviations: `vnnwknpm` made the collateral a
  `TxHash` in every profile (every command that reads a profile, and
  `mint-staging-state` always resolves it); review 2 parses every
  one-shot and the collateral as `TxHash` + `TxIndex` through one
  `oneShot` reader (all eight profiles already hold 64-hex hashes and
  indices of 0 or more). `zkmvmomq` runs the blueprint generator from
  `node_modules/.bin/blueprint` under bun (the installed 0.9.0; no
  registry), and the Justfile `use-env` recipe now does too.
  `mint-tcnight` branches on the request kind, not on an `Option`.
- The committee bridge (user decision 2026-09-25): one deploy command.
  The bridge is the deploy components `committee-bridge` and
  `committee-bridge-threshold`, two new `DEPLOY_STEPS` entries outside
  the default set. Their values (the bootstrap state, `max_fee`) come
  from the env through `Settings`, like the signers. See bridge Plan 06
  task 1.
- A full base deploy (user decision 2026-09-25) is only for a new
  environment. On a test environment it may replace the record and drop
  the bridge names. The bridge is deployed after it with its own
  `--components` run, which extends the record.
- Decided (2026-09-25): the refusal is all or nothing (a selection with
  one promoted validator is refused, no component is skipped). Correct:
  each component is one atomic transaction.
- Decided (2026-09-25): `deploy-staging-track` writes no snapshot and
  checks no production rule. Fine: only the main track is risky.
- Open: the mainnet `versions.json` does not list the six
  `*_staging_forever` validators its `plutus.json` holds. The fix is a
  manual edit of `deployed-scripts/`, the user's decision.

## Preview E2E findings (2026-09-26, user decisions)

- The extend rule kept every entry that was not a created title. A
  two-part deploy over a snapshot from another build left
  `main_gov_auth` stale: no step creates it, but every two-stage datum
  installs it, and it embeds `main_gov_threshold_hash`. The record then
  gave `register-gov-auth` the wrong gov auth. Decision: the build must
  match the live snapshot. Each step lists what it creates and what its
  datums install (the two-stage steps: `main_gov_auth`,
  `staging_gov_auth`). `prepareDeploySnapshot` runs every read, the
  check and the generation before any chain call; a promoted, staged or
  installed validator that the run does not create and whose build hash
  differs is a `BlueprintError` naming the remedy, `build -n <env>
  --from-deployed --components <the run's list>`. The
  snapshot then takes every build entry (a title only it has is kept);
  promoted gains the created and the installed names.
  `writeDeploySnapshot` writes after the build, and the deployment file
  comes last.
- The promoted refusal runs before any chain call.
- `build-from-deployed` is now `build --from-deployed` (user decision):
  one build command. It pins each of the 19 core hashes (6 two-stage, 6
  forever, 7 thresholds) that `deployed-scripts/<env>/plutus.json` has; a
  title the snapshot lacks compiles from new (before, a missing one failed
  the build: the mainnet snapshot has no `beefy_signer_threshold`, so the
  bridge could not be built against mainnet), and so do the validators of
  `--components` (the deploy names, `DEPLOY_COMPONENT_VALIDATORS`; the
  deploy test checks the table against the steps). It goes through the
  `build` program, so it also writes the TypeScript bindings, which the
  old command did not. `--components` without `--from-deployed` is a
  `ValidationError`.
  A from-deployed build runs the standard phases (two-stage, forever,
  thresholds, the logic check) with the pinned keys held at their deployed
  hashes, so a component compiled from new gets its own refreshed hashes
  (a single pass left its forever embedding the old two-stage hash, found
  on preview).
- `changelog.json` drops `gitCommit` (user decision): a secondary jj
  workspace has no git, and the old reader wrote an empty value. The
  schema reads the field in older files.

- The collateral and the one-shots are found among the unspent outputs on
  chain before any build (`resolveUnspent`): Blaze's Blockfrost
  `resolveUnspentOutputs` also returns spent outputs, so the old
  collateral check passed a spent collateral, and the one-shots were
  built locally (`createOneShotUtxo`, deleted) at `--utxo-amount`, so a
  spent one-shot failed only at evaluation, without its reference.
- `--utxo-amount` and `DEPLOY_UTXO_AMOUNT` are gone (user decision
  2026-09-26): with `createOneShotUtxo` deleted they changed no
  transaction. `simple-tx --amount` sets the lovelace of each one-shot
  when it creates it, and each script output takes `calculateMinAda`.
  A new deployment file has no `config`; the schema ignores it in older
  files.
- The governance v2 logic is work in progress. Open: the federated-ops v2
  promote was 17147 bytes, over the 16384 limit. `promote-upgrade`
  registers the v2 logic in the same transaction, and the v2 logic
  scripts are 3.6-5.2 KB (verbose traces, and work done twice in
  `lib/logic/next_version.ak`).

## Carried from the 2026-09-24 preview redeployment

- Done (see the snapshot rule): `saveVersionSnapshot` listed every
  validator in `plutus.json` as `promoted` and kept stale titles on a
  redeploy.
- Preview's six `*_logic_v2_one_shot_hash` entries still reference the
  spent `b585c885…#0..5`; the v2 phase needs its own `simple-tx` and a
  preview rebuild before `mint-staging-state` / `stage-upgrade` run there.
  Picked up by the v2 upgrade QA on preview (plan 07 acceptance).

## Carried from the phase 09 review

- Done in steps 1–3: the options are parsed in `cli/commands/`, and the
  `Options` shapes and the `eslint.config.js` exemptions are gone.
  Parse at the boundary, as plan 09 does for the other commands: each
  of the three commands gets a typed input record in its domain module
  and its options are parsed in `cli/commands/<name>.ts` (`deploy`:
  the four thresholds, `--components`;
  `deploy-staging-track`: `--components`;
  `mint-tcnight`: `--amount`, `--user-address`, `--destination`,
  `--burn`, `--use-build`). The thresholds fall back to their env
  values through `envFallback`. The `Effect.promise` wrappers go, and
  so do `DeployOptions`, `DeployStagingTrackOptions` and
  `MintTcnightOptions` (the kebab-case argv shapes) and the three
  exemptions in `eslint.config.js`.
- Done in step 1: `deploy` wrote `plutus-${network}.json`; the snapshot
  now reads `plutus-<profile>.json`.

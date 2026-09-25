# Phase 06 — CLI and emulator end to end

Goal: deploy, operate and exercise the bridge from the CLI against the
Blaze emulator; every MIP contract-test bullet reproduced (spec §9, §10).

## Tasks

### 0. Prerequisites and style
Runs after `plans/effect/` 01–07: every command here is an Effect
program over a typed input record, parsed at the boundary in
`cli/commands/`, over a `cli/bridge/bridge-tx.ts` builder
(`buildBridgeUpdateTx`, `buildBridgeTopupTx`, `buildBridgeThresholdTx`),
typed errors from `cli/errors.ts`, and the emulator tests call the
builders (Effect plan phase 06 rule). The deployment builders live with
the governance ones in `cli/deploy/builders.ts` (task 1).
Config keys to add to `NetworkConfig`/`parseNetworkConfig`
(`cli/config/settings.ts`, read through `Settings.profile`):
`committee_bridge_one_shot_hash/index`, `committee_threshold_one_shot_hash/index`
(already in every `aiken.toml` profile). `ContractInstances` (read through
`Blueprint.instances`) and `info`'s `contractList` gain the bridge
scripts.

### 1. Deploy through `deploy --components` (one deploy command)
User decision 2026-09-25: there is one deploy command. The bridge is two
new `deploy` components, each one `DEPLOY_STEPS` entry and one atomic
transaction (`cli/deploy/deploy.ts`):
- `committee-bridge` (one-shot `committee_bridge_one_shot_*`):
  `committee_bridge_two_stage_upgrade` main + staging and
  `committee_bridge_forever` with the bootstrap `BeefyConsensusState`
  datum, and the registration of `committee_bridge_logic`. `"committee-bridge"`
  joins the two-stage triples (`UpgradableValidator`, `Blueprint.twoStage`),
  so the step is the existing `twoStage` factory over a bootstrap
  `ForeverMint`.
- `committee-bridge-threshold` (one-shot `committee_threshold_one_shot_*`):
  `beefy_signer_threshold` with `(2, 3, base, per_signer)`. Its own step
  and its own `BeefyThreshold` datum builder, never `MultisigThreshold`
  (same four-`Int` shape).
- Not in the default set: no `--components` stays the twelve
  governance transactions; the two bridge components are built only when
  named: `deploy -n <env> --components committee-bridge,committee-bridge-threshold`.
  `--help` marks the default set. In code: no `--components` (None)
  selects a default list of the twelve, not every `DEPLOY_STEPS` entry.
- The values come from the env through `Settings`, like `TECH_AUTH_SIGNERS`
  and `PERMISSIONED_CANDIDATES`, parsed and checked once there (bootstrap
  rules: `next = current + 1`, both `seat_count > 0`, 32-byte roots). Names
  to settle when the step is written: the bootstrap state (the output of
  phase 07's `bridge-bootstrap`), `max_fee.base` and `max_fee.per_signer`
  (measured in phase 04). A bridge run with a value missing fails before
  any build.
- The record and the preprod/mainnet check need no bridge code: the step's
  validators are the targets, so a live bridge validator is refused, and
  a new one is added to `deployed-scripts/<env>/` with its definitions.
- Reference-script UTxOs for forever, logic and pool: in the
  `committee-bridge` transaction if the size allows, else a third
  component whose transaction creates no validator. Pool needs no
  deployment (script address only); `info` prints its address.
- A full run on a test environment replaces the record (and drops the
  bridge's names). That is correct (user decision 2026-09-25): a full
  base deploy is only for a new environment, and the bridge is deployed
  after it with its own `--components` run, which extends the record.
- Open: a live test-network deploy needs a bootstrap state value, and
  phase 07's `bridge-bootstrap` comes later. The emulator test (task 3)
  builds its own bootstrap state from the phase 05 reference.

### 2. New commands (`cli/commands/bridge-*.ts`)
- `bridge-info`: light-client datum, threshold datum, pool balance and UTxO
  count.
- `bridge-topup --lovelace N`: pay to the pool address.
- `bridge-update --update <json>`: build the update tx from a `BridgeUpdate`
  JSON (the phase 05 `update.ts` shape); `--funded` adds pool inputs and
  sets the debit to the fee; otherwise the submitter pays.
- `bridge-set-fee --base --per-signer` and `bridge-set-threshold`:
  threshold spend under Council + Tech Auth (reuse the change-threshold
  path of the governance commands).

### 3. Emulator test (`tests/bridge_e2e.test.ts`)
Using the phase 05 reference to produce every update:
1. Deploy with committee `c` (4 keys, seats `(1,2,1,1)`), `next = c + 1`.
2. Activation-block justification: accepted, unfunded (pool untouched).
3. Three handovers, funded: the second changes membership. Pool balance
   decreases by ≤ cap each time.
4. Consumer: a test script reads the datum by reference and verifies an
   MMR proof of an earlier block; success. This is a new Aiken test
   validator (`validators/test_bridge_consumer.ak` or under `lib/bridge/`):
   ask before writing it (Aiken guardrail).
5. Rejections on chain: one tx per rule 0–10 and 12–17 fails at phase 2
   (or phase 1 for the value rules).
6. Empty pool: a funded update fails; `bridge-topup`; the same update
   succeeds.
7. Stale datum: build a consumer tx against the datum, land an update, the
   consumer tx fails phase 1.

### 4. Docs
`docs/bridge/spec.md` §9 transaction table verified against the built txs;
README command table gains the `bridge-*` rows.
`docs/governance/live-deployment.md`: the `deploy --components` table
gains the rows `committee-bridge` and `committee-bridge-threshold`, and
the full sequence gains a step that deploys the bridge after the base
with its own `--components` run. `.env.example` gets the bootstrap state
and the `max_fee` variables.

## Acceptance
- `bun test` green; commands run live against the emulator (not only
  type-checked).
- Commit: `cli(bridge): deploy, top-up, update and emulator e2e`.

## Review notes carried from phases 02–04
- `BeefyThreshold` needs its own datum builder: `MultisigThreshold` has the
  same four-`Int` shape and would decode as a valid threshold.
- Deploy creates reference-script UTxOs for the forever, logic and pool
  scripts; the relay must reference them (spec §11, §12). Record the trace
  level of the deployed build; it doubles the reference-script fee.
- Measure the real non-redeemer transaction bytes and the forever and pool
  spend budgets at N = 160 in the emulator; replace the estimates in spec §11.
- Test that the relay trims to `required` signers.

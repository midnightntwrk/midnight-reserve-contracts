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
User decision 2026-09-25: there is one deploy command. User decision
2026-09-26: the bridge is three new `deploy` components, each one
`DEPLOY_STEPS` entry and one atomic transaction (`cli/deploy/deploy.ts`).
At the verbose trace every profile builds with, the two-stage (8,274 B),
forever (2,094 B) and logic (6,788 B) scripts are 17,156 B, over
`maxTxSize` 16,384, so the logic registration cannot share the NFT
transaction:
- `committee-bridge` (one-shot `committee_bridge_one_shot_*`):
  `committee_bridge_two_stage_upgrade` main + staging and
  `committee_bridge_forever` with the bootstrap `BeefyConsensusState`
  datum. `"committee-bridge"` joins the two-stage triples
  (`UpgradableValidator`, `Blueprint.twoStage`), so the step is the
  existing `twoStage` factory over a bootstrap `ForeverMint`, with no
  registration. Its validators are the triple and `committee_bridge_pool`
  (the logic compiles in the pool hash, and the pool the two-stage hash).
- `committee-bridge-threshold` (one-shot `committee_threshold_one_shot_*`):
  `beefy_signer_threshold` with `(numerator, denominator, base,
  per_signer)` and the registration of `committee_bridge_logic` (3,564 +
  6,788 B). Its own step and its own `BeefyThreshold` datum builder, never
  `MultisigThreshold` (same four-`Int` shape).
- `committee-bridge-scripts` (no one-shot): the reference-script UTxOs of
  the forever, logic and pool scripts (9,496 B), at the deployer address
  (user decision 2026-09-26). It creates no validator. The CLI's deployer
  wallet never offers a UTxO that carries a reference script to coin
  selection, so no command spends one by mistake. Pool needs no other
  deployment (script address only); `info` prints its address.
- Not in the default set: no `--components` stays the twelve
  governance transactions; the three bridge components are built only when
  named: `deploy -n <env> --components committee-bridge,committee-bridge-threshold,committee-bridge-scripts`.
  `--help` marks the default set. In code: no `--components` (None)
  selects a default list of the twelve, not every `DEPLOY_STEPS` entry.
- The values come from the env through `Settings`, like the governance
  deploy values (datum values live in `.env`; `aiken.toml` holds only the
  compile-time config), parsed and checked once there (user decision
  2026-09-26):
  - `BRIDGE_ACTIVATION_BLOCK` (u32), `BRIDGE_MMR_ROOT` (32 bytes hex),
    `BRIDGE_CURRENT_COMMITTEE` and `BRIDGE_NEXT_COMMITTEE`, each
    `<validator_set_id>:<seat_count>:<keyset_commitment>`. The bootstrap
    rules: `next = current + 1`, both `seat_count > 0`, 32-byte roots;
    `latest_height` is not an input, it is `activation − 1`. Phase 07's
    `bridge-bootstrap` prints these four lines.
  - `BRIDGE_THRESHOLD` (`n/d`, the `--bridge-threshold` option, fallback
    2/3), like the four governance thresholds.
  - `BRIDGE_MAX_FEE_BASE` and `BRIDGE_MAX_FEE_PER_SIGNER` (lovelace,
    measured in phase 04), required: a bridge run without them fails
    before any build.
- The record and the preprod/mainnet check need no bridge code: the step's
  validators are the targets, so a live bridge validator is refused, and
  a new one is added to `deployed-scripts/<env>/` with its definitions.
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
  threshold spend under Council + Tech Auth. No governance command spends
  a threshold UTxO, so there is no change-threshold path to reuse; the
  builder uses the witness mints (`mintWitnesses`) and the witness
  requirements of the governance commands, with `main_gov_threshold` and
  both authorities' forever UTxOs as reference inputs.

### 3. Emulator test (`tests/bridge_e2e.test.ts`)
Using the phase 05 reference to produce every update:
1. Deploy with committee `c` (4 keys, seats `(1,2,1,1)`), `next = c + 1`.
2. Activation-block justification: accepted, unfunded (pool untouched).
3. Three handovers, funded: the second changes membership. Pool balance
   decreases by ≤ cap each time.
4. Consumer: a test script reads the datum by reference and verifies an
   MMR proof of an earlier block; success. This is a new Aiken test
   validator. Deferred (user decision 2026-09-26): not in phase 06; the
   index lists it as an open item.
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
gains the rows `committee-bridge`, `committee-bridge-threshold` and
`committee-bridge-scripts`, and the full sequence gains a step that
deploys the bridge after the base with its own `--components` run.
`.env.example` gets the bootstrap, `BRIDGE_THRESHOLD` and `max_fee`
variables.

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

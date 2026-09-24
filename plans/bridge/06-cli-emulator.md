# Phase 06 — CLI and emulator end to end

Goal: deploy, operate and exercise the bridge from the CLI against the
Blaze emulator; every MIP contract-test bullet reproduced (spec §9, §10).

## Tasks

### 1. `deploy`
Extend the deploy sequence: `beefy_signer_threshold` with
`(2, 3, base, per_signer)`; `committee_bridge_two_stage_upgrade`;
`committee_bridge_forever` with a bootstrap datum from `--bridge-bootstrap <json>`
(fields of `BeefyConsensusState`); register `committee_bridge_logic`.
Pool needs no deployment (script address only); `info` prints its address.

### 2. New commands (`cli-yargs/commands/bridge-*/`)
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
   MMR proof of an earlier block; success.
5. Rejections on chain: one tx per rule 0–10 and 12–17 fails at phase 2
   (or phase 1 for the value rules).
6. Empty pool: a funded update fails; `bridge-topup`; the same update
   succeeds.
7. Stale datum: build a consumer tx against the datum, land an update, the
   consumer tx fails phase 1.

### 4. Docs
`docs/bridge/spec.md` §9 transaction table verified against the built txs;
README command table gains the `bridge-*` rows.

## Acceptance
- `bun test` green; commands run live against the emulator (not only
  type-checked).
- Commit: `cli(bridge): deploy, top-up, update and emulator e2e`.

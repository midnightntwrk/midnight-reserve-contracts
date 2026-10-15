# Phase 03 — Funding pool

Goal: `committee_bridge_pool` script and MIP rules 12–17 enforced inside
`committee_bridge_logic` (spec §7). Config key in every profile.

## Tasks

### 1. `validators/committee_bridge_pool.ak`
```aiken
validator committee_bridge_pool {
  spend(_datum, _redeemer, _own_ref, tx) {
    // the running logic (two-stage `main` datum) withdraws in this tx
    list.any(tx.withdrawals, fn(w) { w.1st == Script(logic_from_main_ref(tx.reference_inputs)) })
  }
  else(_) { fail }
}
```
Any datum accepted (pool outputs carry none). Script hash depends on
`config.committee_bridge_two_stage_hash` so it is built after the two-stage
hash is known: add it to the build order in
`build-engine.ts` (after `committee_bridge_forever`, before the logic).

### 2. `aiken.toml`
`committee_bridge_pool_hash` under every profile (`default`, `local`,
`preview`, `qanet`, `govnet`, `devnet`, `preprod`, `mainnet`), filled by the
build script; `NetworkConfig` key in the TS config loader.

### 3. `lib/bridge/beefy.ak` — pool rules
```aiken
pub fn check_pool(tx: Transaction, pool: ScriptHash, threshold: BeefyThreshold, handover: Bool, signers: Int) -> Bool
```
- `pool_in`: fold inputs at `Script(pool)`, sum lovelace. If none: `True`.
- Outputs at `Script(pool)`: exactly one; `assets.without_lovelace(value) == zero`
  (rule 12 + lovelace-only); `pool_out` its lovelace.
- `debit = pool_in - pool_out`; `debit <= 0` → `True` (rule 13).
- Else `and { handover, debit <= tx.fee, debit <= base + per_signer * signers }`
  (rules 15, 16, 17). Rule 14 is the enclosing script run.
`verify_update` returns `(state, signers)` (CPS callback) so the validator
has `signers` and `handover = state_in.next.validator_set_id != state_out.next.validator_set_id`.

### 4. `validators/committee_bridge.ak`
After the state equality check: `expect check_pool(transaction, config.committee_bridge_pool_hash, threshold, handover, signers)`.

### 5. Tests
- Pool script: spend with the forever NFT as an input → ok; without → fail.
- Logic, funded handover: `debit = cap = fee` ok; `debit = cap + 1` fail;
  `debit = fee + 1` fail (with `cap > fee`); non-handover with `debit > 0`
  fail; two pool outputs fail; pool output with a token fail; two pool
  inputs merged into one output with `debit ≤ 0` ok; no pool input, no pool
  output ok (unfunded update); pool output with no pool input ok (top-up
  inside an update, `debit < 0`).
- Cost: record mem/cpu delta of an update with vs without a pool input in
  the phase commit message.

## Acceptance
- All green; `committee_bridge_pool` and `committee_bridge_logic` hashes in
  `plutus.json` for every profile.
- Commit: `bridge: funding pool script and rules 12-17`.

# Phase 05 — Reserve v2 timed release

Goal: rewrite `validators/reserve_v2.ak` as the real v2 logic: merge (as
today) + `Release` into the pool under the emission schedule, keeping the
main/staging track switch. Spec §8.

Emission numbers are **TBD**; implement against config keys so only
`aiken.toml` changes when they land.

## Tasks

### 1. `lib/rewards/schedule.ak`
```aiken
pub fn matured(next_amount: Int, decay_num: Int, decay_den: Int, intervals: Int) -> (Int /*released*/, Int /*next_amount'*/)
```
Loop `intervals` times: `released += a; a = a * num / den`. Pure, tested:
`(100, 1, 2, 3) == (175, 12)`; `intervals == 0` fails; decay `1/1` is
constant emission; rounding floors.

### 2. `lib/rewards/release.ak`
```aiken
pub fn reserve_logic_v2(tx: Transaction, info: ScriptInfo, redeemer: Data) -> Bool
```
- `Minting` → one-shot `StagingStateV2` NFT (copy of the `logic_merge_v2`
  mint branch with the third 28-byte field).
- `Withdrawing | Publishing Unregister` → resolve track
  (`logic_is_on_main(reference_inputs, config.reserve_two_stage_hash, own_hash)`):
  main → `(config.reserve_forever_hash, config.cnight_policy, config.rewards_pool_forever_hash)`;
  staging → fields of `StagingStateV2` from own NFT input.
  Then dispatch the redeemer:
  - `Merge` → merge rule (own copy of `merge_values` from
    `logic_merge_v2`, parameterized).
  - `Release { intervals }` → spec §8.2:
    1. `now` = `validity_range.lower_bound` (`Finite`, else fail).
    2. NFT UTXO: input at forever address carrying `(forever_hash, "", 1)`;
       datum is the unit constructor on mainnet today (`Constr 0 []`):
       `builtin.unconstr_fields(datum) == []` → initial state from config;
       otherwise `expect ReleaseState`. Output NFT UTXO: same address, same
       value, inline `ReleaseState'`. Confirm the unit datum against
       `deployments/mainnet/deployment-transactions.json` (`reserve-deployment`)
       before shipping.
    3. `intervals >= 1`, `last + intervals * interval_ms <= now`.
    4. `(released, next') = matured(...)`; `released = min(released, night_in)`.
    5. Reserve value inputs: all other inputs at the forever address; exactly
       one value output with `[ada, night]`, `night_out == night_in − released`,
       `ada_out >= ada_in`, inline datum.
    6. Pool output: exactly one output at `Script(pool_forever)` with
       `night >= released`, `[ada, night]`, inline datum. (The pool's own
       logic `Receive` enforces the merge with existing pool value.)
- `Publishing RegisterCredential` → `True`.

### 3. `validators/reserve_v2.ak`
Replace the stub body with a call to `release.reserve_logic_v2`. Keep the
validator name `reserve_logic_v2` so the existing
`reserve_logic_v2_one_shot_*` keys and `mint-staging-state` CLI apply; add
the pool hash to the staging state mint command later (phase 06).

### 4. Config
`release_t0_ms`, `release_interval_ms`, `release_initial_amount`,
`release_decay_num`, `release_decay_den` per profile (placeholders marked
`# TBD` on `mainnet`/`preprod`).

### 5. Tests `validators/reserve_v2.test.ak`
Extend the pattern in `validators/reserve.test.ak`:
- merge still works (port the relevant v1 tests).
- release: exactly one interval; catch-up of 3; partial catch-up (2 of 5);
  `intervals == 0` fails; too early (`last + n*interval > now`) fails;
  unbounded lower bound fails; released capped at balance; wrong pool
  address fails; pool under-paid fails; reserve value output short fails;
  NFT datum not updated fails; NFT value changed fails; first release from
  a non-`ReleaseState` datum takes the config initial state; second
  release then uses the stored state.
- staging track: same release with `StagingStateV2` hashes.
- ICS: untouched (no release path); assert `ics_logic_v2` compiles as
  before.

### 6. Ops note (not code)
Record in the file header the two-stage steps to ship: stage
`reserve_logic_v2` + mitigation on the reserve two-stage NFT, rehearse on
the staging track (mint `StagingStateV2`, run a staged release to the
staging pool), then promote. The reserve address and NFT are unchanged.

## Done when
- Tests green; `verifyLogicDependencies` confirms the v2 bytecode contains
  `rewards_pool_forever_hash`; `bun test` green (existing reserve emulator
  tests still pass because v1 logic is untouched).

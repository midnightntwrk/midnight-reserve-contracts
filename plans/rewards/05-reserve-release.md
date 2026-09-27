# Phase 05 — Reserve v2 timed release

Built 2026-09-27. Spec §8. `reserve_logic_v2` replaces the always-true
stub: merge (as before) plus `Release` into the rewards pool up to the pool
ceiling, with the main/staging track switch.

## As built

### `lib/rewards/release.ak`
- `reserve_logic(tx, info, redeemer, two_stage_hash, one_shot_ref)`.
- `Minting` → one-shot staging-state NFT; datum `StagingStateV2`
  (`@list [cnight_test_policy, forever_script_hash, pool_forever_hash]`,
  each 28 bytes).
- `Withdrawing` / `Publishing Unregister` → track from
  `logic_is_on_main(reference_inputs, config.reserve_two_stage_hash, own)`:
  main → `(reserve_forever_hash, cnight_policy, rewards_pool_forever_hash)`,
  staging → the `StagingStateV2` fields of the own NFT input. Then:
  - `Merge` → no input carries the forever NFT; the value inputs fit in
    the first `[ada, night]` output at the reserve address; no datum hash.
  - `Release { intervals }` → spec §8.2: finite lower bound `now`;
    `intervals ≥ 1`; `last + intervals × interval ≤ now`; one NFT input
    (deploy datum `Constr 0 [0, 0]` → `release_t0_ms`, else
    `ReleaseState`); `released = min(reserve, max(0, ceiling − pool_in))`
    with the ceiling stepped `intervals` times; outputs: the NFT with
    `ReleaseState { last + intervals × interval }`, same address and
    value; one reserve value output `[ada, night]` with
    `night_in − released`; exactly one pool output `[ada, night]`, inline
    datum, NIGHT `≥ pool_in + released`.
- `Publishing RegisterCredential` → `True`.

### `validators/reserve_v2.ak`
Calls `release.reserve_logic` with the `reserve_logic_v2_one_shot_*` keys.

### Config
`release_t0_ms`, `release_interval_ms`, `release_factor_num`,
`release_factor_den` per profile; `preprod` and `mainnet` marked `# TBD`.

### CLI
- `build-engine.ts`: `reserve_logic_v2` must embed
  `rewards_pool_forever_hash` (`LOGIC_DEPENDENCIES`).
- `mint-staging-state reserve` writes `StagingStateV2` with the staging
  reserve and staging rewards pool forever hashes.

### Tests
`validators/reserve_v2.test.ak`: first interval, catch-up of three,
partial catch-up, net of the pool, pool above the ceiling, too early, zero
intervals, no lower bound, above the ceiling, reserve short, pool short,
time not advanced, NFT value changed, no pool output, no NFT input, the
staging track, merge, and the staging-state mint. Expected ceilings are
computed off-chain. `tests/mint-staging-state.test.ts` mints the reserve
`StagingStateV2` in the emulator against the real script.

## Ops note (not code)
To ship: stage `reserve_logic_v2` + mitigation on the reserve two-stage
NFT, rehearse on the staging track (mint `StagingStateV2`, run a staged
release to the staging pool), then promote. The reserve address and NFT
are unchanged.

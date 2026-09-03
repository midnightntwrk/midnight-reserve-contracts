# Phase 00 — Foundations

Goal: shared types, hash abstraction, auth helper, config plumbing, build
registration, and test fixtures so phases 01–03 can start in parallel.

## Tasks

### 1. `lib/rewards/types.ak`
Define exactly the types in spec §3, §4.1, §5.1, §5.3, §7, §8.1, §9:
`Registration`, `Deposit`, `Head`, `AccountDatum`, `AccountMintRedeemer`
(`InitHead | Register { skh, cred_kind } | BurnDeposit | BurnRegistration` — the
last only inside a `SetDeregister` tx),
`AccountSpendRedeemer` (`Withdraw | TopUp | SetDeregister(Address) | AnchorInsert | BatcherPay | UpdateRegistration | Deregister`),
`BatcherState`, `BatcherRedeemer`, `PayPair`, `ExitInfo`, `DigestProof`,
`Digest`, `ReserveRedeemer`, `ReleaseState`, `StagingStateV2`, `PoolRedeemer`.
Keep constructors ordered as listed in the spec; blueprint consumers rely on
the indices.

### 2. `lib/rewards/hash.ak`
```aiken
pub fn leaf_hash(leaf: ByteArray) -> ByteArray   // keccak_256
pub fn node_hash(l: ByteArray, r: ByteArray) -> ByteArray
```
Decided: keccak-256. Kept as the single switch point anyway. Unit test with
one known vector each.

### 3. `lib/rewards/auth.ak`
`stake_auth(cred, extra_signatories, withdrawals)` per spec §2.1. Tests: key
present / absent; script withdrawal present / absent.

### 4. `aiken.toml` — all 8 profiles
Add keys from spec §13. Use the existing placeholder style for one-shot
hashes (`[config.<env>.<name>_one_shot_hash] bytes = "00…NN" encoding = "hex"`,
index `0`/`1`). Numeric constants inline. For `local`/`devnet`:
`release_interval_ms = 60_000`, small `release_initial_amount`. Keep
`release_*` values obviously placeholder (comment `# TBD`) on mainnet.

### 5. `cli-yargs/lib/build-engine.ts`
- Add `rewards_pool` to `TWO_STAGE_CORE` and `FOREVER_CORE` (titles
  `rewards_pool.rewards_pool_two_stage_upgrade.else`,
  `rewards_pool.rewards_pool_forever.else`; toml keys
  `rewards_pool_two_stage_hash`, `rewards_pool_forever_hash`).
- New table `FIXED_HASHES` written back in the final pass:
  `rewards_batcher.rewards_batcher.else → rewards_batcher_hash`,
  `virtual_account.virtual_account.else → virtual_account_hash`.
- Order: batcher and account hashes must be written before the pool logic
  and reserve logic are compiled for the final time; confirm the existing
  5-pass loop already re-compiles after every write, else add a pass.
- Extend `verifyLogicDependencies` to check the pool logic bytecode
  contains `rewards_batcher_hash` and reserve logic v2 contains
  `rewards_pool_forever_hash`.
- `cli-yargs/lib/types.ts` `NetworkConfig`: add the new keys.

### 6. Test fixtures `lib/rewards/test_fixtures.ak`
Non-`pub`-exported helpers used by the phase tests (Aiken allows test-only
modules; keep it under `lib/` so validators can import in tests):
- fake 28-byte hashes (`account_policy`, `batcher_hash`, `pool_forever`,
  `bridge_forever`) in the repo's `#"..."` style;
- `mk_deposit_output(skh, ada, night, next, committed)`,
  `mk_head_output(next)`, `mk_registration_output(...)`,
  `mk_state_output(state)`, `mk_pool_output(ada, night)`;
- `mk_input(outref, output)`, `withdrawal_of(hash)`, `ref_input_bridge(root)`;
- `ctx_mint(tx, policy)`, `ctx_spend(tx, outref, datum)`, `ctx_withdraw(tx, hash)`.

### 7. Blueprint type exporters
`validators/validator_types_rewards.ak` with `z_rewards_types` exporting
`AccountDatum`, `AccountMintRedeemer`, `AccountSpendRedeemer`, `BatcherState`,
`BatcherRedeemer`, `ReleaseState`, `PoolRedeemer` (body `fail`, same idiom as
`validator_types_v2.ak`).

## Done when
- `just build` for every `--env` succeeds with the new keys.
- `aiken check` runs the hash and auth tests.
- `bun test` unchanged and green.

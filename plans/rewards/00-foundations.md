# Phase 00 — Foundations — DONE (commit `a07f629`)

Delivered: `lib/rewards/{types,auth,fold,value,test_fixtures}.ak`, config
keys in all 8 profiles, `NetworkConfig` + `loadAikenConfig` keys,
`validators/validator_types_rewards.ak`. Reviewed and adjusted by the user;
spec §14 "Phase 00/01 review adjustments" lists the deltas from the original
plan.

## As built

### `lib/rewards/types.ak`
`tail_key`; `AccountDatum { Head { next }, Deposit { cred, next, committed }, Registration { owner, destinations, operator_keys }, Tail }`;
`AccountGate { User, Batcher }`; `AccountAction { kind, offset }`;
`ActionKind { InitList, Register, Withdraw, TopUp, SetDeregister, UpdateRegistration }`;
`BatcherState` (`start_key`, `cursor` plain bytes); `BatcherRedeemer { Pay, LoadAndPay }`;
`PayPair`; `ExitInfo`; `DigestProof`; `Digest`; `ReserveRedeemer`;
`ReleaseState`; `StagingStateV2`; `PoolRedeemer { Receive, Disburse }`.
Constructor order is the blueprint contract: append only.

### Hashing
`builtin.keccak_256` inline wherever a leaf or node is hashed; no wrapper.

### `lib/rewards/auth.ak`
`stake_auth(cred, extra_signatories, withdrawals)` with four tests.

### `lib/rewards/value.ak`, `lib/rewards/fold.ak`
`tokens_of`, `quantity`, `claim`, `split_ada`, `only_nft`; `foldl2` (CPS,
two accumulators). Used by `account.ak`; reuse in `batch.ak`.

### `aiken.toml`
Spec §13 keys in every profile. Mainnet `release_*` are `# TBD`
placeholders (`initial_amount 0`).

### `cli-yargs/lib/build-engine.ts`
`FIXED` table (hash published, never rebuilt against) holds
`virtual_account_hash` (added in phase 01). Phase 04 adds
`rewards_batcher.rewards_batcher.else → rewards_batcher_hash`, the pool
triple to `TWO_STAGE_CORE` / `FOREVER_CORE`, and the
`verifyLogicDependencies` checks (pool logic contains `rewards_batcher_hash`,
reserve logic v2 contains `rewards_pool_forever_hash`). `updateHash` throws
on a title missing from the blueprint, so each mapping lands with its
validator.

### `lib/rewards/test_fixtures.ak`
Fixture builders for outputs, inputs, withdrawals, reference inputs and
script contexts; extend for phases 02–05 rather than duplicating.

### `validators/validator_types_rewards.ak`
`z_rewards_types` exports `AccountDatum`, `AccountGate`, `AccountAction`,
`BatcherRedeemer`, `BatcherState`, `PoolRedeemer`, `ReleaseState`.

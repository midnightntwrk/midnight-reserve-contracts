# Phase 04 — Rewards pool and batcher

Goal: `rewards_batcher` (fixed) and the `rewards_pool` triple (upgradable)
per spec §5, §9, §10; batch payouts and exits validated end to end in Aiken
tests.

## Tasks

### 1. `validators/rewards_pool.ak` + `validators/staging_rewards_pool.ak`
Clone `validators/reserve.ak` / `staging_reserve_ics.ak` shape:
`rewards_pool_forever` (one-shot `config.rewards_pool_one_shot_*`,
two-stage `config.rewards_pool_two_stage_hash`, init validation no-op),
`rewards_pool_two_stage_upgrade`, `rewards_pool_logic`,
`rewards_pool_staging_forever`.

`rewards_pool_logic` (withdraw + publish, plus `StagingStateV2` one-shot
mint like `logic_merge_v2`):
- `Receive` → merge rule: reuse the value-shape check from
  `logic_merge_v2` (own copy in `lib/rewards/pool.ak`, parameterized by
  forever hash and cnight policy; do not import `lib/logic/next_version`'s
  internals if they are not `pub`).
- `Pay` → `list.any(withdrawals, cred == Script(config.rewards_batcher_hash))`.
Track switch via `logic_is_on_main` exactly as `logic_merge_v2`.

Mitigation logic for the pool: reuse whatever the reserve uses today for
`mitigation_logic` (check `deployments/` config for the reserve main NFT
datum); document in the file header which script is expected.

### 2. `validators/rewards_batcher.ak`
```aiken
validator rewards_batcher {
  else(ctx) {
    when info is {
      Minting(p) -> batch.init_state(tx, p, config.rewards_batcher_one_shot_*)
      Spending { output, .. } -> batch.spend_gate(tx, own_hash)      // own withdrawal present
      Withdrawing(Script(h)) -> batch.validate(tx, h, redeemer)
      Publishing { RegisterCredential } -> True
      _ -> fail
    }
  }
}
```

### 3. `lib/rewards/batch.ak`
- `init_state`: `input_linked_mint` (from `lib/utils.ak`) + shape checks
  (spec §5.1).
- `validate(tx, own_hash, redeemer: Data)`:
  1. `state_in` = inline datum of the input holding own NFT `""`;
     `state_out` = same for outputs (`is_singleton` from utils works: value
     is ADA + NFT only).
  2. Dispatch `LoadEpoch | PayBatch | LoadAndPay`.
- `load(state_in, digest_proof, reference_inputs) -> BatcherState` (spec
  §5.3 LoadEpoch): bridge state from the reference input carrying
  `config.committee_bridge_forever_hash` singleton NFT
  (`get_input_state_by_policy(reference_inputs, …)`), `verify_digest`,
  succession, reset cursor fields.
- `pay(state_in, proof, pairs, exits, tx) -> BatcherState` (spec §5.3
  PayBatch):
  - `leaves = verify_range(state_in.root, proof) |> map(parse_leaf)`;
  - split into anchor / paid / boundary per §5.3 step 3 (write as a pure
    function `split_run(state, keys) -> (paid_keys, new_cursor, complete)`
    and unit-test it exhaustively — this is the core invariant);
  - for each paid leaf with its `PayPair`: `input = list.at(inputs, i)`,
    `output = list.at(outputs, o)`; input value carries
    `(account_policy, deposit_name(key), 1)`; indices strictly increasing
    across pairs; `ack == 0` → pay rule; `ack == 1` → exit rule with
    `ExitInfo` (predecessor in/out via `unlink`, refund output, burn present
    in `mint`);
  - pool: fold inputs at `Script(state.pool_forever)` (fail if any carries
    the pool forever NFT), exactly one output there, NIGHT conservation,
    ADA non-decreasing, `[ada, night]` shape, inline datum;
  - result state; compare with `state_out` (`==` on the whole record).
- Skim: `n_paid = length(paid)`; `cap = min((tx.fee + n_paid − 1) / n_paid, config.batcher_skim_max_lovelace)`;
  per paid deposit `ADA_in − ADA_out ≤ cap` (exit: refund `ADA ≥ ADA_in − cap`).
  The batcher takes the skims as free change. Test: fee padded to 5 ADA
  with 3 paid leaves → cap is the config max, not 1.67 ADA.

### 4. Tests `validators/rewards_batcher.test.ak`, `validators/rewards_pool.test.ak`
Build a 7-leaf sorted digest with the phase 02 builder (keys `k1 < … < k7`),
deposits for all seven in a list, pool with NIGHT.
- init: ok; bad hash length; `complete == False` at init fails.
- load: ok on complete state; on incomplete state fails; epoch `+2` fails;
  bad digest proof fails; empty epoch (`min_key == ""`) → complete.
- first batch from each of the 7 possible starts, run length 1..7:
  `split_run` table test.
- full fold from start `k4`: batches `[k4,k5]`, `[k6,k7]`, wrap `[k1]`,
  `[k2,k3,+boundary k4]` → complete. Then `LoadEpoch` for the next epoch ok.
- start `k1`: `[k1..k7]` → complete via `cursor == max && start == min`.
- start `k7`: `[k7]`, wrap `[k1..k6, +boundary k7]` → complete.
- failures: non-contiguous proof; run that includes `start_key` again;
  jump to `min_key` when `cursor != max_key`; anchor key ≠ cursor; paying a
  leaf twice across batches; wrong deposit NFT for a leaf; skim above
  `fee / n_paid`; skim above the config max with a padded fee;
  NIGHT under-paid; pool over-drawn; two pairs pointing at one output;
  exit leaf with `committed == None`; exit without burn; exit without
  predecessor relink; refund short.
- pool logic: `Receive` merge ok / value decreased fails; `Pay` without
  batcher withdrawal fails.
- budget: record mem/cpu for a 30-pair batch with depth-16 proof; adjust
  the recommended K in spec §5.4.

## Done when
- Tests green; `rewards_batcher_hash`, `rewards_pool_*_hash` written to all
  profiles by the build; blueprint exports include the batcher redeemer.

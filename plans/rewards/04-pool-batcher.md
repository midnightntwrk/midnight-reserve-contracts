# Phase 04 — Rewards pool and batcher — DONE (commits `220aa50`, `17c7432`, `93075d5`)

Delivered: `lib/rewards/batch.ak`, `lib/rewards/pool.ak`,
`lib/rewards/digest_builder.ak` (test-only), `validators/rewards_batcher.ak`,
(`lib/rewards/trie.ak` + `trie_builder.ak` added in the digest-carrier
revision, see plan 03),
`validators/rewards_pool.ak`, `validators/staging_rewards_pool.ak`,
`validators/rewards_batcher.test.ak` (86 tests),
`validators/rewards_pool.test.ak` (29 tests); `rewards_batcher_hash`,
`rewards_pool_{two_stage,forever}_hash` written by the build. Spec §5, §9
are the authoritative description; this page records how it was built and
what phases 05 and 06 must honour.

## As built

### Cursor model (spec §5.1, §5.3)
`cursor` is the **next key to pay**. A run is `[cursor, …, lookahead]`:
every leaf before the lookahead is paid and the lookahead becomes the new
cursor; a run whose last leaf is `max_key` pays it and sets
`cursor := min_key`; a lookahead equal to `start_key` closes the epoch
(`complete := cursor == start_key`). `LoadAndPay` sets
`start_key := cursor := key(leaves[0])` before the same rule. Every batch
pays at least one leaf and the epoch completes in the batch that pays its
last leaf. The original "cursor = last paid, anchor + boundary" model could
strand an epoch one leaf short of completion.

### `lib/rewards/batch.ak`
```aiken
pub fn init_state(tx, own_policy, one_shot_ref) -> Bool       // 28-byte hashes, complete == True
pub fn spend_gate(withdrawals, own_hash) -> Bool              // own withdrawal present
pub fn validate(tx, own_hash, redeemer: Data) -> Bool         // Pay | LoadAndPay; state_out == pay(...)
pub fn load(state, digest_proof, reference_inputs) -> Digest  // bridge ref input, verify_digest, epoch + 1
pub fn leaves(root, proof) -> List<RewardLeaf>
pub fn pay(state, leaves, pairs, exits, tx) -> BatcherState
pub fn split_run(state, leaves, return: fn(paid, cursor) -> r) -> r
```
- Indices: `pairs[i]` = `(input_index, output_index)` of the i-th paid leaf
  in leaf order; for an `ack = 1` leaf the output is the **refund** and the
  next `ExitInfo { pred_input_index, pred_output_index }` names the
  predecessor (`unlink`). Both index sequences strictly increase; `pairs`
  and `exits` are consumed exactly.
- Count check: inputs carrying an `account_policy` token
  `== len(paid) + len(exits)`.
- Skim cap `min(ceil(fee / n_paid), batcher_skim_max_lovelace)` applies to
  the deposit output and to the refund alike.
- Deposit output = same address and datum, non-ADA part
  `== from_asset(account_policy, 0x00 ++ key, 1) + NIGHT_in + amount`.
- Pool: inputs at `Script(pool_forever)` summed (forever NFT forbidden),
  exactly one output there with `[ada, night]`, NIGHT exactly
  `in − Σ amount`, ADA not decreased, inline datum. Empty epoch: no account
  and no pool inputs, no pool output required.
- Budget probe (`budget_30_pairs` − `budget_30_pairs_fixture_only`): 30
  paid leaves, 64-leaf tree ≈ 10.3 M mem / 3.7 G cpu for the batcher.
  With ~0.13 M mem per account gate the mainnet ceiling is K ≈ 25.

### `lib/rewards/pool.ak`
`pool_logic(tx, info, redeemer, two_stage_hash, one_shot_ref)`: mint of the
`StagingState` NFT (one-shot `rewards_pool_logic_one_shot_*`), `Receive`
merge on the main (`config.rewards_pool_forever_hash`, `config.cnight_policy`)
or staging track (`StagingState` from the own NFT input), `Disburse` =
batcher withdrawal present, `RegisterCredential` = `True`.

### Validators
- `rewards_batcher`: `Minting` → `init_state`; `Spending` → `spend_gate`;
  `Withdrawing` → `validate`; `Publishing RegisterCredential` → `True`.
- `rewards_pool_forever` / `rewards_pool_two_stage_upgrade` /
  `rewards_pool_logic`: `reserve.ak` shape; `rewards_pool_staging_forever`:
  `staging_reserve_ics.ak` shape.

### Build
`build-engine.ts`: pool two-stage / forever in the `*_EXTRA` tables (not in
deployed blueprints); `FIXED = [rewards_batcher, virtual_account]` written
after the threshold phase so the final compile embeds the batcher hash in
the account and pool logic.

### Tests
Batcher: init, spend gate / publish, load (succession, digest proof, bridge
reference, empty epoch with and without stray inputs, next epoch after
completion), `split_run` table over every start and run length plus
boundary / crossing / anchor cases, folds from `k1`, `k4`, `k7`, run
failures, deposit and pool failures, skim, exits (incl. head predecessor
and first-batch exit), budget. Pool: `Receive` on the main and staging
tracks, `Disburse`, publish, staging mint, forever / staging forever mint
and spend.

Run with `aiken check -m 'rewards_batcher.{..}'` / `-m 'rewards_pool.{..}'`
on a TTY (piped runs print nothing).

## Contract with phase 05 (reserve release)
- The release tx spends pool value UTXOs and runs `rewards_pool_logic`
  with `Receive`: the first output at the pool forever credential must hold
  `[ada, night]` with an inline datum and at least the summed inputs.
- `config.rewards_pool_forever_hash` is populated in the default profile;
  `StagingStateV2.pool_forever_hash` carries the staging pool forever.

## Contract with phase 06 (TypeScript)
- Off-chain run builder: reveal `[cursor .. lookahead]`; pay everything but
  the lookahead unless the run ends at `max_key`; put the `start_key` leaf
  last to close the epoch.
- `PayPair.output_index` is the refund output for an exit; `ExitInfo` has
  two fields.

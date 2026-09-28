use aiken/builtin
use aiken/collection/list
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{Value, add, from_asset, from_lovelace, zero}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{Publishing, ScriptContext, Spending}
use cardano/transaction.{
  DatumHash, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use config
use rewards/batch.{split_run}
use rewards/digest_builder.{digest_proof}
use rewards/merkle_range.{RewardLeaf, parse_leaf}
use rewards/merkle_range_builder.{build_proof, build_proof_indices, build_root}
use rewards/test_fixtures.{
  account_policy, batcher_hash, ctx_mint, ctx_withdraw, mk_deposit_output,
  mk_head_output, mk_input, mk_outref, mk_pool_output, mk_state_output,
  pool_forever, ref_input_bridge, withdrawal_of,
}
use rewards/types.{BatcherRedeemer, BatcherState, Digest, Load, Pay, tail_key}
use rewards_batcher

// -- fixtures ----------------------------------------------------------------

const zero28 = #"00000000000000000000000000000000000000000000000000000000"

const zero32 =
  #"0000000000000000000000000000000000000000000000000000000000000000"

const dep_ada = 20_000_000

const pool_ada = 10_000_000

const pool_night = 1_000_000

const fee = 200_000

const refund = Address(VerificationKey(zero28), None)

/// `+1` of a deposit NFT for a key that has no deposit.
const forged_deposit_nft =
  from_asset(
    account_policy,
    builtin.append_bytearray(#"00", builtin.integer_to_bytearray(True, 28, 9)),
    1,
  )

fn k(i: Int) -> ByteArray {
  builtin.integer_to_bytearray(True, 28, i)
}

fn amount(i: Int) -> Int {
  1000 * i
}

fn leaf_bytes(ack: Int, i: Int) -> ByteArray {
  builtin.integer_to_bytearray(True, 1, ack)
    |> builtin.append_bytearray(k(i))
    |> builtin.append_bytearray(
        builtin.integer_to_bytearray(True, 16, amount(i)),
      )
}

/// Seven leaves `k1 < … < k7`; leaf `exit` (0 = none) has `ack = 1`.
fn tree(exit: Int) -> List<ByteArray> {
  list.map(
    list.range(1, 7),
    fn(i) {
      if i == exit {
        leaf_bytes(1, i)
      } else {
        leaf_bytes(0, i)
      }
    },
  )
}

const leaves7 = tree(0)

const root7 = build_root(leaves7)

fn parsed(ls: List<ByteArray>, from: Int, to: Int) -> List<RewardLeaf> {
  list.slice(ls, from - 1, to - 1) |> list.map(parse_leaf)
}

/// Proof revealing leaves `from..to` (1-based).
fn proof(ls: List<ByteArray>, from: Int, to: Int) {
  build_proof(ls, from - 1, to - 1)
}

fn st(root: ByteArray, cursor: ByteArray, complete: Bool) -> BatcherState {
  BatcherState {
    account_policy,
    pool_forever,
    epoch: 5,
    root,
    max_key: k(7),
    cursor,
    complete,
  }
}

const init_state =
  BatcherState {
    account_policy,
    pool_forever,
    epoch: 4,
    root: zero32,
    max_key: zero28,
    cursor: zero28,
    complete: True,
  }

const digest5 =
  Digest {
    epoch: 5,
    leaf_count: 7,
    root: root7,
    min_key: k(1),
    max_key: k(7),
    treasury_total: 0,
  }

fn next_of(i: Int) -> ByteArray {
  if i == 7 {
    tail_key
  } else {
    k(i + 1)
  }
}

fn dep_in(i: Int) -> Output {
  mk_deposit_output(k(i), dep_ada, 0, next_of(i), None)
}

fn dep_out(i: Int, skim: Int) -> Output {
  mk_deposit_output(k(i), dep_ada - skim, amount(i), next_of(i), None)
}

fn sum_amounts(paid: List<Int>) -> Int {
  list.foldl(paid, 0, fn(i, acc) { acc + amount(i) })
}

/// Inputs: state, pool, deposits. Outputs: state, pool, deposit outputs.
fn batch_tx(
  state_in: BatcherState,
  state_out: BatcherState,
  pool_out_night: Int,
  dep_ins: List<Output>,
  dep_outs: List<Output>,
  mint: Value,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      mk_input(mk_outref(1), mk_state_output(state_in)),
      mk_input(mk_outref(2), mk_pool_output(pool_ada, pool_night)),
      ..list.indexed_map(dep_ins, fn(i, o) { mk_input(mk_outref(10 + i), o) })
    ],
    outputs: [
      mk_state_output(state_out),
      mk_pool_output(pool_ada, pool_out_night),
      ..dep_outs
    ],
    mint,
    fee,
    withdrawals: [withdrawal_of(batcher_hash)],
  }
}

fn run(tx: Transaction, redeemer: BatcherRedeemer) -> Bool {
  rewards_batcher.rewards_batcher.else(ctx_withdraw(tx, redeemer, batcher_hash))
}

/// `Pay` revealing `from..to` and paying `paid` with no skim.
fn simple_pay(
  state_in: BatcherState,
  state_out: BatcherState,
  from: Int,
  to: Int,
  paid: List<Int>,
) -> Bool {
  let tx =
    batch_tx(
      state_in,
      state_out,
      pool_night - sum_amounts(paid),
      list.map(paid, dep_in),
      list.map(paid, fn(i) { dep_out(i, 0) }),
      zero,
    )
  run(tx, Pay { proof: proof(leaves7, from, to) })
}

fn with_bridge(tx: Transaction, mmr_root: ByteArray) -> Transaction {
  Transaction { ..tx, reference_inputs: [ref_input_bridge(mmr_root)] }
}

/// A `Load` of `digest` from `state_in`: inputs the state and `extra_in`, outputs the state and `rest`; the bridge holds the digest's MMR root.
fn load_tx(
  state_in: BatcherState,
  state_out: BatcherState,
  digest: Digest,
  extra_in: List<Output>,
  rest: List<Output>,
) -> Transaction {
  let (mmr_root, _) = digest_proof(digest)
  Transaction {
    ..placeholder,
    inputs: [
      mk_input(mk_outref(1), mk_state_output(state_in)),
      ..list.indexed_map(extra_in, fn(i, o) { mk_input(mk_outref(10 + i), o) })
    ],
    outputs: [mk_state_output(state_out), ..rest],
    fee,
    withdrawals: [withdrawal_of(batcher_hash)],
  }
    |> with_bridge(mmr_root)
}

fn load_redeemer(digest: Digest) -> BatcherRedeemer {
  let (_, dp) = digest_proof(digest)
  Load { digest_proof: dp }
}

/// A `Load` of `digest` from `init_state` with no other input or output.
fn simple_load(state_out: BatcherState, digest: Digest) -> Bool {
  run(load_tx(init_state, state_out, digest, [], []), load_redeemer(digest))
}

/// `init_state` after the `Load` of `digest5`: the fold starts at `min_key`.
const loaded5 = st(root7, k(1), False)

// -- init ----------------------------------------------------------------------

fn init_tx(state: BatcherState) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      Input(
        OutputReference(
          config.rewards_batcher_one_shot_hash,
          config.rewards_batcher_one_shot_index,
        ),
        Output(refund, from_lovelace(5_000_000), NoDatum, None),
      ),
    ],
    outputs: [mk_state_output(state)],
    mint: from_asset(batcher_hash, "", 1),
  }
}

fn run_mint(tx: Transaction) -> Bool {
  let r: Data = Void
  rewards_batcher.rewards_batcher.else(ctx_mint(tx, r, batcher_hash))
}

test init_ok() {
  run_mint(init_tx(init_state))
}

test init_short_account_policy() fail {
  run_mint(init_tx(BatcherState { ..init_state, account_policy: #"aa" }))
}

test init_short_pool_forever() fail {
  run_mint(init_tx(BatcherState { ..init_state, pool_forever: #"" }))
}

test init_incomplete() fail {
  run_mint(init_tx(BatcherState { ..init_state, complete: False }))
}

test init_without_one_shot() fail {
  run_mint(Transaction { ..init_tx(init_state), inputs: [] })
}

test init_two_tokens() fail {
  run_mint(
    Transaction {
      ..init_tx(init_state),
      mint: from_asset(batcher_hash, "", 1) |> add(batcher_hash, "x", 1),
    },
  )
}

// -- spend gate / publish --------------------------------------------------------

fn spend_ctx(tx: Transaction) -> ScriptContext {
  let d: Data = init_state
  let r: Data = Void
  ScriptContext(tx, r, Spending(mk_outref(1), Some(d)))
}

test spend_gate_ok() {
  let tx = batch_tx(init_state, init_state, pool_night, [], [], zero)
  rewards_batcher.rewards_batcher.else(spend_ctx(tx))
}

test spend_gate_without_withdrawal() fail {
  let tx =
    Transaction {
      ..batch_tx(init_state, init_state, pool_night, [], [], zero),
      withdrawals: [withdrawal_of(account_policy)],
    }
  rewards_batcher.rewards_batcher.else(spend_ctx(tx))
}

test publish_registration_ok() {
  let r: Data = Void
  rewards_batcher.rewards_batcher.else(
    ScriptContext(
      placeholder,
      r,
      Publishing {
        at: 0,
        certificate: RegisterCredential {
          credential: Script(batcher_hash),
          deposit: Never,
        },
      },
    ),
  )
}

// -- load ------------------------------------------------------------------------

test load_ok() {
  simple_load(loaded5, digest5)
}

test load_on_incomplete_state() fail {
  run(
    load_tx(
      BatcherState { ..init_state, complete: False },
      loaded5,
      digest5,
      [],
      [],
    ),
    load_redeemer(digest5),
  )
}

test load_epoch_skip() fail {
  simple_load(
    BatcherState { ..loaded5, epoch: 6 },
    Digest { ..digest5, epoch: 6 },
  )
}

test load_same_epoch() fail {
  simple_load(
    BatcherState { ..loaded5, epoch: 4 },
    Digest { ..digest5, epoch: 4 },
  )
}

test load_bad_digest_proof() fail {
  run(
    load_tx(init_state, loaded5, digest5, [], []) |> with_bridge(zero32),
    load_redeemer(digest5),
  )
}

test load_without_bridge_reference() fail {
  run(
    Transaction {
      ..load_tx(init_state, loaded5, digest5, [], []),
      reference_inputs: [],
    },
    load_redeemer(digest5),
  )
}

test load_wrong_root_in_state_out() fail {
  simple_load(st(zero32, k(1), False), digest5)
}

test load_cursor_not_min_key() fail {
  simple_load(st(root7, k(2), False), digest5)
}

test load_marks_complete() fail {
  simple_load(st(root7, k(1), True), digest5)
}

test load_with_deposit_input() fail {
  run(
    load_tx(init_state, loaded5, digest5, [dep_in(4)], [dep_in(4)]),
    load_redeemer(digest5),
  )
}

test load_mints_account_nft() fail {
  run(
    Transaction {
      ..load_tx(init_state, loaded5, digest5, [], []),
      mint: forged_deposit_nft,
    },
    load_redeemer(digest5),
  )
}

test load_with_pool_input_without_treasury() fail {
  let pool = mk_pool_output(pool_ada, pool_night)
  run(
    load_tx(init_state, loaded5, digest5, [pool], [pool]),
    load_redeemer(digest5),
  )
}

test load_next_epoch_after_complete() {
  let digest = Digest { ..digest5, epoch: 6 }
  run(
    load_tx(
      st(root7, k(6), True),
      BatcherState { ..loaded5, epoch: 6 },
      digest,
      [],
      [],
    ),
    load_redeemer(digest),
  )
}

const empty_digest =
  Digest {
    epoch: 5,
    leaf_count: 0,
    root: zero32,
    min_key: zero28,
    max_key: zero28,
    treasury_total: 0,
  }

/// `init_state` after the `Load` of an empty epoch 5: still complete.
const loaded_empty = BatcherState { ..init_state, epoch: 5 }

test load_empty_epoch_ok() {
  simple_load(loaded_empty, empty_digest)
}

test load_empty_epoch_marks_incomplete() fail {
  simple_load(BatcherState { ..loaded_empty, complete: False }, empty_digest)
}

// -- split_run table ----------------------------------------------------------------

/// A run from `s` revealing `l` leaves: the paid leaves and the next cursor, `None` once it pays max_key.
fn split_expected(s: Int, l: Int) -> (List<RewardLeaf>, Option<ByteArray>) {
  let end = s + l - 1
  if end == 7 {
    (parsed(leaves7, s, 7), None)
  } else {
    (parsed(leaves7, s, end - 1), Some(k(end)))
  }
}

fn split_case(s: Int, l: Int) -> Bool {
  let
    paid,
    next,
  <- split_run(st(root7, k(s), False), parsed(leaves7, s, s + l - 1))
  (paid, next) == split_expected(s, l)
}

test split_run_table() {
  list.all(
    list.range(1, 7),
    fn(s) { list.all(list.range(2, 8 - s), fn(l) { split_case(s, l) }) },
  )
}

test split_run_single_max_leaf() {
  split_case(7, 1)
}

test split_run_single_leaf_without_lookahead() fail {
  split_case(3, 1)
}

test split_run_head_not_cursor() fail {
  let paid, _ <- split_run(st(root7, k(6), False), parsed(leaves7, 5, 7))
  paid == []
}

// -- folds -----------------------------------------------------------------------

test fold_first_batch() {
  simple_pay(loaded5, st(root7, k(3), False), 1, 3, [1, 2])
}

test fold_middle_batch() {
  simple_pay(st(root7, k(3), False), st(root7, k(6), False), 3, 6, [3, 4, 5])
}

test fold_last_batch_completes() {
  simple_pay(st(root7, k(6), False), st(root7, k(6), True), 6, 7, [6, 7])
}

test fold_single_batch_completes() {
  simple_pay(loaded5, st(root7, k(1), True), 1, 7, [1, 2, 3, 4, 5, 6, 7])
}

test fold_lookahead_is_never_max() {
  // A run that reaches the leaf before max_key pays max_key too.
  simple_pay(st(root7, k(5), False), st(root7, k(5), True), 5, 7, [5, 6, 7])
}

// -- run failures ------------------------------------------------------------------

test pay_on_complete_state() fail {
  simple_pay(st(root7, k(1), True), st(root7, k(3), False), 1, 3, [1, 2])
}

test pay_head_not_cursor() fail {
  simple_pay(st(root7, k(6), False), st(root7, k(7), False), 5, 7, [5, 6])
}

test pay_without_lookahead() fail {
  simple_pay(st(root7, k(6), False), st(root7, k(6), False), 6, 6, [6])
}

test pay_non_contiguous_proof() fail {
  let tx =
    batch_tx(
      loaded5,
      st(root7, k(3), False),
      pool_night - amount(1),
      [dep_in(1)],
      [dep_out(1, 0)],
      zero,
    )
  run(tx, Pay { proof: build_proof_indices(leaves7, [0, 2]) })
}

test pay_wrong_root_state_out() fail {
  simple_pay(loaded5, st(zero32, k(3), False), 1, 3, [1, 2])
}

test pay_wrong_cursor_state_out() fail {
  simple_pay(loaded5, st(root7, k(4), False), 1, 3, [1, 2])
}

test pay_premature_complete() fail {
  simple_pay(loaded5, st(root7, k(1), True), 1, 3, [1, 2])
}

test pay_last_run_left_incomplete() fail {
  simple_pay(st(root7, k(6), False), st(root7, k(6), False), 6, 7, [6, 7])
}

test pay_completing_run_moves_cursor() fail {
  simple_pay(st(root7, k(6), False), st(root7, k(1), True), 6, 7, [6, 7])
}

// -- deposit and pool failures -----------------------------------------------------

fn two_paid_tx(dep_outs: List<Output>, pool_out_night: Int) -> Transaction {
  batch_tx(
    st(root7, k(6), False),
    st(root7, k(6), True),
    pool_out_night,
    [dep_in(6), dep_in(7)],
    dep_outs,
    zero,
  )
}

fn two_paid(tx: Transaction) -> Bool {
  run(tx, Pay { proof: proof(leaves7, 6, 7) })
}

const two_total = amount(6) + amount(7)

test pay_wrong_deposit_nft() fail {
  let tx =
    batch_tx(
      st(root7, k(6), False),
      st(root7, k(6), True),
      pool_night - two_total,
      [dep_in(6), dep_in(5)],
      [dep_out(6, 0), dep_out(7, 0)],
      zero,
    )
  two_paid(tx)
}

test pay_night_underpaid() fail {
  let short = mk_deposit_output(k(7), dep_ada, amount(7) - 1, tail_key, None)
  two_paid(two_paid_tx([dep_out(6, 0), short], pool_night - two_total))
}

test pay_night_overpaid() fail {
  let over = mk_deposit_output(k(7), dep_ada, amount(7) + 1, tail_key, None)
  two_paid(two_paid_tx([dep_out(6, 0), over], pool_night - two_total - 1))
}

test pay_deposit_datum_changed() fail {
  let changed = mk_deposit_output(k(7), dep_ada, amount(7), k(1), None)
  two_paid(two_paid_tx([dep_out(6, 0), changed], pool_night - two_total))
}

test pay_deposit_moved() fail {
  let moved = Output { ..dep_out(7, 0), address: refund }
  two_paid(two_paid_tx([dep_out(6, 0), moved], pool_night - two_total))
}

test pay_deposit_extra_asset() fail {
  let extra =
    Output {
      ..dep_out(7, 0),
      value: dep_out(7, 0).value |> add(batcher_hash, "x", 1),
    }
  two_paid(two_paid_tx([dep_out(6, 0), extra], pool_night - two_total))
}

test pay_pool_overdrawn() fail {
  two_paid(
    two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total - 1),
  )
}

test pay_pool_under_decreased() fail {
  two_paid(
    two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total + 1),
  )
}

test pay_pool_ada_decreased() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  let outputs =
    list.indexed_map(
      tx.outputs,
      fn(i, o) {
        if i == 1 {
          mk_pool_output(pool_ada - 1, pool_night - two_total)
        } else {
          o
        }
      },
    )
  two_paid(Transaction { ..tx, outputs })
}

test pay_pool_ada_increased_ok() {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  let outputs =
    list.indexed_map(
      tx.outputs,
      fn(i, o) {
        if i == 1 {
          mk_pool_output(pool_ada + 1, pool_night - two_total)
        } else {
          o
        }
      },
    )
  two_paid(Transaction { ..tx, outputs })
}

test pay_pool_forever_nft_spent() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  let nft_utxo =
    Output {
      ..mk_pool_output(pool_ada, 0),
      value: from_lovelace(2_000_000) |> add(pool_forever, "", 1),
    }
  two_paid(
    Transaction {
      ..tx,
      inputs: list.concat(tx.inputs, [mk_input(mk_outref(3), nft_utxo)]),
    },
  )
}

test pay_pool_output_not_second() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  expect [state_out, pool_out, ..deposits] = tx.outputs
  two_paid(
    Transaction {
      ..tx,
      outputs: [state_out, ..list.concat(deposits, [pool_out])],
    },
  )
}

test pay_pool_output_with_stake_part() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  let outputs =
    list.indexed_map(
      tx.outputs,
      fn(i, o) {
        if i == 1 {
          Output {
            ..o,
            address: Address(
              Script(pool_forever),
              Some(Inline(VerificationKey(zero28))),
            ),
          }
        } else {
          o
        }
      },
    )
  two_paid(Transaction { ..tx, outputs })
}

test pay_state_output_not_first() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  expect [state_out, ..rest] = tx.outputs
  two_paid(Transaction { ..tx, outputs: list.concat(rest, [state_out]) })
}

test pay_state_output_with_stake_part() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  expect [state_out, ..rest] = tx.outputs
  let staked =
    Output {
      ..state_out,
      address: Address(
        state_out.address.payment_credential,
        Some(Inline(VerificationKey(zero28))),
      ),
    }
  two_paid(Transaction { ..tx, outputs: [staked, ..rest] })
}

test pay_pool_output_without_datum() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  let outputs =
    list.indexed_map(
      tx.outputs,
      fn(i, o) {
        if i == 1 {
          Output { ..o, datum: NoDatum }
        } else {
          o
        }
      },
    )
  two_paid(Transaction { ..tx, outputs })
}

test pay_two_pool_inputs_summed_ok() {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  let outputs =
    list.indexed_map(
      tx.outputs,
      fn(i, o) {
        if i == 1 {
          mk_pool_output(2 * pool_ada, pool_night + 500 - two_total)
        } else {
          o
        }
      },
    )
  two_paid(
    Transaction {
      ..tx,
      inputs: list.concat(
        tx.inputs,
        [mk_input(mk_outref(3), mk_pool_output(pool_ada, 500))],
      ),
      outputs,
    },
  )
}

test pay_deposit_outputs_out_of_leaf_order() fail {
  two_paid(two_paid_tx([dep_out(7, 0), dep_out(6, 0)], pool_night - two_total))
}

test pay_deposits_in_any_ledger_order() {
  let tx =
    batch_tx(
      st(root7, k(6), False),
      st(root7, k(6), True),
      pool_night - two_total,
      [dep_in(7), dep_in(6)],
      [dep_out(6, 0), dep_out(7, 0)],
      zero,
    )
  two_paid(tx)
}

test pay_deposit_missing() fail {
  let tx =
    batch_tx(
      st(root7, k(6), False),
      st(root7, k(6), True),
      pool_night - two_total,
      [dep_in(6)],
      [dep_out(6, 0), dep_out(7, 0)],
      zero,
    )
  two_paid(tx)
}

test pay_deposit_output_missing() fail {
  two_paid(two_paid_tx([dep_out(6, 0)], pool_night - two_total))
}

test pay_extra_deposit_input() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  two_paid(
    Transaction {
      ..tx,
      inputs: list.concat(tx.inputs, [mk_input(mk_outref(20), dep_in(3))]),
    },
  )
}

test pay_extra_head_input() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  two_paid(
    Transaction {
      ..tx,
      inputs: list.concat(
        tx.inputs,
        [mk_input(mk_outref(20), mk_head_output(k(1)))],
      ),
    },
  )
}

test pay_mints_account_nft() fail {
  let tx =
    batch_tx(
      st(root7, k(6), False),
      st(root7, k(6), True),
      pool_night - sum_amounts([6, 7]),
      list.map([6, 7], dep_in),
      list.map([6, 7], fn(i) { dep_out(i, 0) }),
      forged_deposit_nft,
    )
  run(tx, Pay { proof: proof(leaves7, 6, 7) })
}

// -- skim ----------------------------------------------------------------------------

fn skim_tx(skim: Int, tx_fee: Int) -> Transaction {
  Transaction {
    ..two_paid_tx([dep_out(6, skim), dep_out(7, skim)], pool_night - two_total),
    fee: tx_fee,
  }
}

test skim_at_fee_share_ok() {
  two_paid(skim_tx(3_000, 6_000))
}

test skim_above_fee_share() fail {
  two_paid(skim_tx(3_001, 6_000))
}

test skim_rounds_up() {
  two_paid(skim_tx(3_001, 6_001))
}

test skim_at_config_max_with_padded_fee() {
  two_paid(skim_tx(config.batcher_skim_max_lovelace, 5_000_000))
}

test skim_above_config_max_with_padded_fee() fail {
  two_paid(skim_tx(config.batcher_skim_max_lovelace + 1, 5_000_000))
}

// -- exits -----------------------------------------------------------------------------

const exit_tree = tree(3)

const exit_root = build_root(exit_tree)

fn committed_dep(i: Int, night_in: Int) -> Output {
  mk_deposit_output(k(i), dep_ada, night_in, next_of(i), Some(refund))
}

fn refund_out(ada: Int, night: Int) -> Output {
  Output(
    refund,
    from_lovelace(ada)
      |> add(config.cnight_policy, config.cnight_name, night),
    NoDatum,
    None,
  )
}

const exit_burn =
  from_asset(account_policy, builtin.append_bytearray(#"00", k(3)), -1)

/// Leaves [k3 (exit), k4]; inputs: state, pool, deposit k3, predecessor k2.
fn exit_tx(
  pred_in: Output,
  pred_out: Output,
  dep: Output,
  refund_output: Output,
  mint: Value,
) -> Transaction {
  batch_tx(
    st(exit_root, k(3), False),
    st(exit_root, k(4), False),
    pool_night - amount(3),
    [dep, pred_in],
    [pred_out, refund_output],
    mint,
  )
}

fn run_exit(tx: Transaction) -> Bool {
  run(tx, Pay { proof: proof(exit_tree, 3, 4) })
}

const exit_night_in = 777

fn good_exit_tx() -> Transaction {
  exit_tx(
    mk_deposit_output(k(2), dep_ada, 0, k(3), None),
    mk_deposit_output(k(2), dep_ada, 0, k(4), None),
    committed_dep(3, exit_night_in),
    refund_out(dep_ada, exit_night_in + amount(3)),
    exit_burn,
  )
}

test exit_ok() {
  run_exit(good_exit_tx())
}

test exit_with_skim_ok() {
  let tx =
    exit_tx(
      mk_deposit_output(k(2), dep_ada, 0, k(3), None),
      mk_deposit_output(k(2), dep_ada, 0, k(4), None),
      committed_dep(3, exit_night_in),
      refund_out(dep_ada - 10_000, exit_night_in + amount(3) + 5),
      exit_burn,
    )
  run_exit(Transaction { ..tx, fee: 5_000_000 })
}

test exit_refund_short_ada() fail {
  let tx =
    exit_tx(
      mk_deposit_output(k(2), dep_ada, 0, k(3), None),
      mk_deposit_output(k(2), dep_ada, 0, k(4), None),
      committed_dep(3, exit_night_in),
      refund_out(dep_ada - 10_001, exit_night_in + amount(3)),
      exit_burn,
    )
  run_exit(Transaction { ..tx, fee: 5_000_000 })
}

test exit_refund_short_night() fail {
  run_exit(
    exit_tx(
      mk_deposit_output(k(2), dep_ada, 0, k(3), None),
      mk_deposit_output(k(2), dep_ada, 0, k(4), None),
      committed_dep(3, exit_night_in),
      refund_out(dep_ada, exit_night_in + amount(3) - 1),
      exit_burn,
    ),
  )
}

test exit_refund_wrong_address() fail {
  let tx = good_exit_tx()
  let outputs =
    list.indexed_map(
      tx.outputs,
      fn(i, o) {
        if i == 3 {
          Output { ..o, address: Address(VerificationKey(k(9)), None) }
        } else {
          o
        }
      },
    )
  run_exit(Transaction { ..tx, outputs })
}

test exit_not_committed() fail {
  run_exit(
    exit_tx(
      mk_deposit_output(k(2), dep_ada, 0, k(3), None),
      mk_deposit_output(k(2), dep_ada, 0, k(4), None),
      mk_deposit_output(k(3), dep_ada, exit_night_in, k(4), None),
      refund_out(dep_ada, exit_night_in + amount(3)),
      exit_burn,
    ),
  )
}

test exit_without_burn() fail {
  run_exit(Transaction { ..good_exit_tx(), mint: zero })
}

test exit_with_extra_mint() fail {
  run_exit(
    Transaction {
      ..good_exit_tx(),
      mint: assets.merge(exit_burn, forged_deposit_nft),
    },
  )
}

test exit_without_relink() fail {
  run_exit(
    exit_tx(
      mk_deposit_output(k(2), dep_ada, 0, k(3), None),
      mk_deposit_output(k(2), dep_ada, 0, k(3), None),
      committed_dep(3, exit_night_in),
      refund_out(dep_ada, exit_night_in + amount(3)),
      exit_burn,
    ),
  )
}

test exit_wrong_predecessor() fail {
  run_exit(
    exit_tx(
      mk_deposit_output(k(1), dep_ada, 0, k(2), None),
      mk_deposit_output(k(1), dep_ada, 0, k(4), None),
      committed_dep(3, exit_night_in),
      refund_out(dep_ada, exit_night_in + amount(3)),
      exit_burn,
    ),
  )
}

test exit_without_predecessor_input() fail {
  let tx = good_exit_tx()
  run_exit(
    Transaction {
      ..tx,
      inputs: list.filter(
        tx.inputs,
        fn(i) { i.output != mk_deposit_output(k(2), dep_ada, 0, k(3), None) },
      ),
    },
  )
}

test exit_refund_before_predecessor() fail {
  let tx = good_exit_tx()
  expect [state_out, pool_out, pred_o, refund_o, ..rest] = tx.outputs
  run_exit(
    Transaction {
      ..tx,
      outputs: [state_out, pool_out, refund_o, pred_o, ..rest],
    },
  )
}

test exit_leaf_paid_as_deposit() fail {
  // ack = 1 leaf with a continuing deposit output instead of a refund.
  let tx =
    batch_tx(
      st(exit_root, k(3), False),
      st(exit_root, k(4), False),
      pool_night - amount(3),
      [committed_dep(3, exit_night_in)],
      [
        mk_deposit_output(
          k(3),
          dep_ada,
          exit_night_in + amount(3),
          k(4),
          Some(refund),
        ),
      ],
      zero,
    )
  run(tx, Pay { proof: proof(exit_tree, 3, 4) })
}

test exit_predecessor_is_head_ok() {
  let t = tree(1)
  let r = build_root(t)
  let tx =
    batch_tx(
      st(r, k(1), False),
      st(r, k(2), False),
      pool_night - amount(1),
      [committed_dep(1, 0), mk_head_output(k(1))],
      [mk_head_output(k(2)), refund_out(dep_ada, amount(1))],
      from_asset(account_policy, builtin.append_bytearray(#"00", k(1)), -1),
    )
  run(tx, Pay { proof: proof(t, 1, 2) })
}

/// Run [k2, k3 (exit)], lookahead k4: k2 is paid and is k3's predecessor.
fn paid_pred_tx(k2_out: Output) -> Transaction {
  batch_tx(
    st(exit_root, k(2), False),
    st(exit_root, k(4), False),
    pool_night - amount(2) - amount(3),
    [dep_in(2), committed_dep(3, exit_night_in)],
    [k2_out, refund_out(dep_ada, exit_night_in + amount(3))],
    exit_burn,
  )
}

test exit_after_paid_predecessor_ok() {
  run(
    paid_pred_tx(mk_deposit_output(k(2), dep_ada, amount(2), k(4), None)),
    Pay { proof: proof(exit_tree, 2, 4) },
  )
}

test exit_after_paid_predecessor_not_relinked() fail {
  run(paid_pred_tx(dep_out(2, 0)), Pay { proof: proof(exit_tree, 2, 4) })
}

test exit_at_max_key_after_paid_predecessor_ok() {
  let t = tree(7)
  let r = build_root(t)
  let tx =
    batch_tx(
      st(r, k(6), False),
      st(r, k(6), True),
      pool_night - amount(6) - amount(7),
      [dep_in(6), committed_dep(7, 0)],
      [
        mk_deposit_output(k(6), dep_ada, amount(6), tail_key, None),
        refund_out(dep_ada, amount(7)),
      ],
      from_asset(account_policy, builtin.append_bytearray(#"00", k(7)), -1),
    )
  run(tx, Pay { proof: proof(t, 6, 7) })
}

test two_exits_in_a_row_ok() {
  let t =
    list.map(
      list.range(1, 7),
      fn(i) {
        if i == 3 || i == 4 {
          leaf_bytes(1, i)
        } else {
          leaf_bytes(0, i)
        }
      },
    )
  let r = build_root(t)
  let tx =
    batch_tx(
      st(r, k(3), False),
      st(r, k(5), False),
      pool_night - amount(3) - amount(4),
      [
        mk_deposit_output(k(2), dep_ada, 0, k(3), None),
        committed_dep(3, 0),
        committed_dep(4, 0),
      ],
      [
        mk_deposit_output(k(2), dep_ada, 0, k(5), None),
        refund_out(dep_ada, amount(3)),
        refund_out(dep_ada, amount(4)),
      ],
      from_asset(account_policy, builtin.append_bytearray(#"00", k(3)), -1)
        |> add(account_policy, builtin.append_bytearray(#"00", k(4)), -1),
    )
  run(tx, Pay { proof: proof(t, 3, 5) })
}

// -- budget ------------------------------------------------------------------------------

const big_n = 64

const big_tree = list.map(list.range(1, big_n), fn(i) { leaf_bytes(0, i) })

const big_root = build_root(big_tree)

fn big_state(cursor: ByteArray, complete: Bool) -> BatcherState {
  BatcherState { ..st(big_root, cursor, complete), max_key: k(big_n) }
}

fn big_next(i: Int) -> ByteArray {
  if i == big_n {
    tail_key
  } else {
    k(i + 1)
  }
}

/// 30 paid leaves from a 64-leaf tree (depth 6), lookahead k31.
fn budget_tx() -> Transaction {
  let paid = list.range(1, 30)
  let tx =
    batch_tx(
      big_state(k(1), False),
      big_state(k(31), False),
      pool_night - sum_amounts(paid),
      list.map(
        paid,
        fn(i) { mk_deposit_output(k(i), dep_ada, 0, big_next(i), None) },
      ),
      list.map(
        paid,
        fn(i) {
          mk_deposit_output(k(i), dep_ada - 5_000, amount(i), big_next(i), None)
        },
      ),
      zero,
    )
  Transaction { ..tx, fee: 1_000_000 }
}

fn budget_redeemer() -> BatcherRedeemer {
  Pay { proof: build_proof(big_tree, 0, 30) }
}

/// Fixture cost alone; subtract from `budget_30_pairs` for the validator's share.
test budget_30_pairs_fixture_only() {
  let tx = budget_tx()
  expect Pay { proof } = budget_redeemer()
  and {
    list.length(tx.inputs) == 32,
    list.length(proof) == 2,
  }
}

test budget_30_pairs() {
  run(budget_tx(), budget_redeemer())
}

// -- treasury ----------------------------------------------------------------------

const treasury = 40_000

const ics = Address(Script(config.ics_forever_hash), None)

fn ics_output(night: Int) -> Output {
  Output(
    ics,
    from_lovelace(2_000_000)
      |> add(config.cnight_policy, config.cnight_name, night),
    NoDatum,
    None,
  )
}

const digest_t = Digest { ..digest5, treasury_total: treasury }

const pool_in = mk_pool_output(pool_ada, pool_night)

/// The `Load` of `digest_t`: the pool pays `pool_paid`, then `extra` outputs.
fn treasury_load(pool_paid: Int, extra: List<Output>) -> Bool {
  run(
    load_tx(
      init_state,
      loaded5,
      digest_t,
      [pool_in],
      [mk_pool_output(pool_ada, pool_night - pool_paid), ..extra],
    ),
    load_redeemer(digest_t),
  )
}

test load_pays_treasury() {
  treasury_load(treasury, [ics_output(treasury)])
}

test load_treasury_missing_ics_output() fail {
  treasury_load(treasury, [])
}

test load_treasury_ics_underpaid() fail {
  treasury_load(treasury, [ics_output(treasury - 1)])
}

test load_treasury_ics_overpaid() fail {
  treasury_load(treasury, [ics_output(treasury + 1)])
}

test load_treasury_left_in_pool() fail {
  treasury_load(0, [ics_output(treasury)])
}

test load_treasury_ics_output_with_datum_hash() fail {
  treasury_load(
    treasury,
    [Output { ..ics_output(treasury), datum: DatumHash(zero32) }],
  )
}

test load_treasury_ics_output_extra_asset() fail {
  let out = ics_output(treasury)
  treasury_load(
    treasury,
    [Output { ..out, value: out.value |> add(batcher_hash, "x", 1) }],
  )
}

test load_treasury_ics_output_with_stake_part() fail {
  let staked =
    Address(
      Script(config.ics_forever_hash),
      Some(Inline(VerificationKey(zero28))),
    )
  treasury_load(treasury, [Output { ..ics_output(treasury), address: staked }])
}

test load_treasury_ics_before_pool() fail {
  run(
    load_tx(
      init_state,
      loaded5,
      digest_t,
      [pool_in],
      [ics_output(treasury), mk_pool_output(pool_ada, pool_night - treasury)],
    ),
    load_redeemer(digest_t),
  )
}

/// The load also merges an ICS UTXO of `treasury` NIGHT into its ICS output, so one output could satisfy both the merge and the payment.
test load_treasury_with_ics_merge() fail {
  run(
    load_tx(
      init_state,
      loaded5,
      digest_t,
      [pool_in, ics_output(treasury)],
      [mk_pool_output(pool_ada, pool_night - treasury), ics_output(treasury)],
    ),
    load_redeemer(digest_t),
  )
}

test load_empty_epoch_pays_treasury() {
  let digest = Digest { ..empty_digest, treasury_total: treasury }
  run(
    load_tx(
      init_state,
      loaded_empty,
      digest,
      [pool_in],
      [mk_pool_output(pool_ada, pool_night - treasury), ics_output(treasury)],
    ),
    load_redeemer(digest),
  )
}

test pay_takes_no_treasury() fail {
  // Only the load pays the Treasury share; a completing run takes exactly its leaves.
  let tx =
    batch_tx(
      st(root7, k(6), False),
      st(root7, k(6), True),
      pool_night - two_total - treasury,
      [dep_in(6), dep_in(7)],
      [dep_out(6, 0), dep_out(7, 0), ics_output(treasury)],
      zero,
    )
  two_paid(tx)
}

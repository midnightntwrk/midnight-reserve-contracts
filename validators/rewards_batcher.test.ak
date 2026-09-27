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
use rewards/types.{
  BatcherRedeemer, BatcherState, Digest, ExitInfo, LoadAndPay, Pay, PayPair,
  tail_key,
}
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

fn st(
  root: ByteArray,
  start: ByteArray,
  cursor: ByteArray,
  complete: Bool,
) -> BatcherState {
  BatcherState {
    account_policy,
    pool_forever,
    epoch: 5,
    root,
    min_key: k(1),
    max_key: k(7),
    treasury_total: 0,
    start_key: start,
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
    min_key: zero28,
    max_key: zero28,
    treasury_total: 0,
    start_key: zero28,
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

fn pairs_for(n: Int) -> List<PayPair> {
  list.map(
    list.range(0, n - 1),
    fn(i) { PayPair { input_index: 2 + i, output_index: 2 + i } },
  )
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
  run(
    tx,
    Pay {
      proof: proof(leaves7, from, to),
      pairs: pairs_for(list.length(paid)),
      exits: [],
    },
  )
}

fn with_bridge(tx: Transaction, mmr_root: ByteArray) -> Transaction {
  Transaction { ..tx, reference_inputs: [ref_input_bridge(mmr_root)] }
}

/// `LoadAndPay` of `digest` revealing `from..to` and paying `paid` with no skim.
fn simple_load(
  state_in: BatcherState,
  state_out: BatcherState,
  digest: Digest,
  from: Int,
  to: Int,
  paid: List<Int>,
) -> Bool {
  let (mmr_root, dp) = digest_proof(digest)
  let tx =
    batch_tx(
      state_in,
      state_out,
      pool_night - sum_amounts(paid),
      list.map(paid, dep_in),
      list.map(paid, fn(i) { dep_out(i, 0) }),
      zero,
    )
      |> with_bridge(mmr_root)
  run(
    tx,
    LoadAndPay {
      digest_proof: dp,
      proof: proof(leaves7, from, to),
      pairs: pairs_for(list.length(paid)),
      exits: [],
    },
  )
}

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

test load_first_batch_ok() {
  simple_load(init_state, st(root7, k(4), k(6), False), digest5, 4, 6, [4, 5])
}

test load_on_incomplete_state() fail {
  let state_in = BatcherState { ..init_state, complete: False }
  simple_load(state_in, st(root7, k(4), k(6), False), digest5, 4, 6, [4, 5])
}

test load_epoch_skip() fail {
  let digest = Digest { ..digest5, epoch: 6 }
  simple_load(
    init_state,
    BatcherState { ..st(root7, k(4), k(6), False), epoch: 6 },
    digest,
    4,
    6,
    [4, 5],
  )
}

test load_same_epoch() fail {
  let digest = Digest { ..digest5, epoch: 4 }
  simple_load(
    init_state,
    BatcherState { ..st(root7, k(4), k(6), False), epoch: 4 },
    digest,
    4,
    6,
    [4, 5],
  )
}

test load_bad_digest_proof() fail {
  let (_, dp) = digest_proof(digest5)
  let tx =
    batch_tx(
      init_state,
      st(root7, k(4), k(6), False),
      pool_night - sum_amounts([4, 5]),
      [dep_in(4), dep_in(5)],
      [dep_out(4, 0), dep_out(5, 0)],
      zero,
    )
      |> with_bridge(zero32)
  run(
    tx,
    LoadAndPay {
      digest_proof: dp,
      proof: proof(leaves7, 4, 6),
      pairs: pairs_for(2),
      exits: [],
    },
  )
}

test load_without_bridge_reference() fail {
  let (_, dp) = digest_proof(digest5)
  let tx =
    batch_tx(
      init_state,
      st(root7, k(4), k(6), False),
      pool_night - sum_amounts([4, 5]),
      [dep_in(4), dep_in(5)],
      [dep_out(4, 0), dep_out(5, 0)],
      zero,
    )
  run(
    tx,
    LoadAndPay {
      digest_proof: dp,
      proof: proof(leaves7, 4, 6),
      pairs: pairs_for(2),
      exits: [],
    },
  )
}

test load_wrong_root_in_state_out() fail {
  simple_load(init_state, st(zero32, k(4), k(6), False), digest5, 4, 6, [4, 5])
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

fn empty_tx(state_out: BatcherState) -> Transaction {
  let (mmr_root, _) = digest_proof(empty_digest)
  Transaction {
    ..placeholder,
    inputs: [mk_input(mk_outref(1), mk_state_output(init_state))],
    outputs: [mk_state_output(state_out)],
    fee,
    withdrawals: [withdrawal_of(batcher_hash)],
  }
    |> with_bridge(mmr_root)
}

fn empty_redeemer() -> BatcherRedeemer {
  let (_, dp) = digest_proof(empty_digest)
  LoadAndPay { digest_proof: dp, proof: [], pairs: [], exits: [] }
}

test load_empty_epoch_ok() {
  run(empty_tx(BatcherState { ..init_state, epoch: 5 }), empty_redeemer())
}

test load_empty_epoch_marks_incomplete() fail {
  run(
    empty_tx(BatcherState { ..init_state, epoch: 5, complete: False }),
    empty_redeemer(),
  )
}

test load_empty_epoch_with_proof() fail {
  let (_, dp) = digest_proof(empty_digest)
  run(
    empty_tx(BatcherState { ..init_state, epoch: 5 }),
    LoadAndPay {
      digest_proof: dp,
      proof: proof(leaves7, 4, 6),
      pairs: [],
      exits: [],
    },
  )
}

test load_empty_epoch_with_deposit_input() fail {
  let tx = empty_tx(BatcherState { ..init_state, epoch: 5 })
  run(
    Transaction {
      ..tx,
      inputs: [mk_input(mk_outref(10), dep_in(4)), ..tx.inputs],
      outputs: [dep_in(4), ..tx.outputs],
    },
    empty_redeemer(),
  )
}

test load_empty_epoch_with_pool_input() fail {
  let tx = empty_tx(BatcherState { ..init_state, epoch: 5 })
  run(
    Transaction {
      ..tx,
      inputs: [
        mk_input(mk_outref(2), mk_pool_output(pool_ada, pool_night)),
        ..tx.inputs
      ],
      outputs: [mk_pool_output(pool_ada, pool_night), ..tx.outputs],
    },
    empty_redeemer(),
  )
}

test load_next_epoch_after_complete() {
  let state_in = st(root7, k(4), k(4), True)
  let digest = Digest { ..digest5, epoch: 6 }
  simple_load(
    state_in,
    BatcherState { ..st(root7, k(1), k(1), True), epoch: 6 },
    digest,
    1,
    7,
    [1, 2, 3, 4, 5, 6, 7],
  )
}

// -- split_run table ----------------------------------------------------------------

/// First batch from `s`, revealing `l` leaves: paid and next cursor per the run rule.
fn split_expected(s: Int, l: Int) -> (List<RewardLeaf>, ByteArray) {
  let end = s + l - 1
  if end == 7 {
    (parsed(leaves7, s, 7), k(1))
  } else {
    (parsed(leaves7, s, end - 1), k(end))
  }
}

fn split_case(s: Int, l: Int) -> Bool {
  let state = st(root7, k(s), k(s), False)
  let paid, cursor <- split_run(state, parsed(leaves7, s, s + l - 1))
  (paid, cursor) == split_expected(s, l)
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

test split_run_boundary_after_wrap() {
  let state = st(root7, k(4), k(1), False)
  let paid, cursor <- split_run(state, parsed(leaves7, 1, 4))
  (paid, cursor) == (parsed(leaves7, 1, 3), k(4))
}

test split_run_short_of_boundary() {
  let state = st(root7, k(4), k(1), False)
  let paid, cursor <- split_run(state, parsed(leaves7, 1, 3))
  (paid, cursor) == (parsed(leaves7, 1, 2), k(3))
}

test split_run_crossing_start() fail {
  let state = st(root7, k(4), k(1), False)
  let paid, _ <- split_run(state, parsed(leaves7, 1, 5))
  paid == []
}

test split_run_head_not_cursor() fail {
  let state = st(root7, k(4), k(6), False)
  let paid, _ <- split_run(state, parsed(leaves7, 5, 7))
  paid == []
}

// -- folds -----------------------------------------------------------------------

test fold_k4_batch2() {
  simple_pay(
    st(root7, k(4), k(6), False),
    st(root7, k(4), k(1), False),
    6,
    7,
    [6, 7],
  )
}

test fold_k4_batch3() {
  simple_pay(
    st(root7, k(4), k(1), False),
    st(root7, k(4), k(2), False),
    1,
    2,
    [1],
  )
}

test fold_k4_batch4_completes() {
  simple_pay(
    st(root7, k(4), k(2), False),
    st(root7, k(4), k(4), True),
    2,
    4,
    [2, 3],
  )
}

test fold_k1_single_batch_completes() {
  simple_load(
    init_state,
    st(root7, k(1), k(1), True),
    digest5,
    1,
    7,
    [1, 2, 3, 4, 5, 6, 7],
  )
}

test fold_k7_first_batch_wraps() {
  simple_load(init_state, st(root7, k(7), k(1), False), digest5, 7, 7, [7])
}

test fold_k7_second_batch_completes() {
  simple_pay(
    st(root7, k(7), k(1), False),
    st(root7, k(7), k(7), True),
    1,
    7,
    [1, 2, 3, 4, 5, 6],
  )
}

test fold_k6_lookahead_is_max() {
  // A run ending at max_key pays it; the lookahead is never max_key.
  simple_pay(
    st(root7, k(4), k(5), False),
    st(root7, k(4), k(1), False),
    5,
    7,
    [5, 6, 7],
  )
}

// -- run failures ------------------------------------------------------------------

test pay_on_complete_state() fail {
  simple_pay(
    st(root7, k(4), k(4), True),
    st(root7, k(4), k(6), False),
    4,
    6,
    [4, 5],
  )
}

test pay_head_not_cursor() fail {
  simple_pay(
    st(root7, k(4), k(6), False),
    st(root7, k(4), k(7), False),
    5,
    7,
    [5, 6],
  )
}

test pay_wrap_before_max() fail {
  simple_pay(
    st(root7, k(4), k(6), False),
    st(root7, k(4), k(2), False),
    1,
    2,
    [1],
  )
}

test pay_crossing_start() fail {
  simple_pay(
    st(root7, k(4), k(2), False),
    st(root7, k(4), k(6), False),
    2,
    6,
    [2, 3, 4, 5],
  )
}

test pay_without_lookahead() fail {
  simple_pay(
    st(root7, k(4), k(6), False),
    st(root7, k(4), k(6), False),
    6,
    6,
    [6],
  )
}

test pay_non_contiguous_proof() fail {
  let tx =
    batch_tx(
      st(root7, k(4), k(1), False),
      st(root7, k(4), k(3), False),
      pool_night - amount(1),
      [dep_in(1)],
      [dep_out(1, 0)],
      zero,
    )
  run(
    tx,
    Pay {
      proof: build_proof_indices(leaves7, [0, 2]),
      pairs: pairs_for(1),
      exits: [],
    },
  )
}

test pay_wrong_root_state_out() fail {
  simple_pay(
    st(root7, k(4), k(6), False),
    st(zero32, k(4), k(1), False),
    6,
    7,
    [6, 7],
  )
}

test pay_wrong_cursor_state_out() fail {
  simple_pay(
    st(root7, k(4), k(6), False),
    st(root7, k(4), k(7), False),
    6,
    7,
    [6, 7],
  )
}

test pay_premature_complete() fail {
  simple_pay(
    st(root7, k(4), k(6), False),
    st(root7, k(4), k(1), True),
    6,
    7,
    [6, 7],
  )
}

// -- deposit and pool failures -----------------------------------------------------

fn two_paid_tx(dep_outs: List<Output>, pool_out_night: Int) -> Transaction {
  batch_tx(
    st(root7, k(4), k(6), False),
    st(root7, k(4), k(1), False),
    pool_out_night,
    [dep_in(6), dep_in(7)],
    dep_outs,
    zero,
  )
}

fn two_paid(tx: Transaction, pairs: List<PayPair>) -> Bool {
  run(tx, Pay { proof: proof(leaves7, 6, 7), pairs, exits: [] })
}

const two_total = amount(6) + amount(7)

test pay_wrong_deposit_nft() fail {
  let tx =
    batch_tx(
      st(root7, k(4), k(6), False),
      st(root7, k(4), k(1), False),
      pool_night - two_total,
      [dep_in(6), dep_in(5)],
      [dep_out(6, 0), dep_out(7, 0)],
      zero,
    )
  two_paid(tx, pairs_for(2))
}

test pay_night_underpaid() fail {
  let short = mk_deposit_output(k(7), dep_ada, amount(7) - 1, tail_key, None)
  two_paid(
    two_paid_tx([dep_out(6, 0), short], pool_night - two_total),
    pairs_for(2),
  )
}

test pay_night_overpaid() fail {
  let over = mk_deposit_output(k(7), dep_ada, amount(7) + 1, tail_key, None)
  two_paid(
    two_paid_tx([dep_out(6, 0), over], pool_night - two_total - 1),
    pairs_for(2),
  )
}

test pay_deposit_datum_changed() fail {
  let changed = mk_deposit_output(k(7), dep_ada, amount(7), k(1), None)
  two_paid(
    two_paid_tx([dep_out(6, 0), changed], pool_night - two_total),
    pairs_for(2),
  )
}

test pay_deposit_moved() fail {
  let moved = Output { ..dep_out(7, 0), address: refund }
  two_paid(
    two_paid_tx([dep_out(6, 0), moved], pool_night - two_total),
    pairs_for(2),
  )
}

test pay_deposit_extra_asset() fail {
  let extra =
    Output {
      ..dep_out(7, 0),
      value: dep_out(7, 0).value |> add(batcher_hash, "x", 1),
    }
  two_paid(
    two_paid_tx([dep_out(6, 0), extra], pool_night - two_total),
    pairs_for(2),
  )
}

test pay_pool_overdrawn() fail {
  two_paid(
    two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total - 1),
    pairs_for(2),
  )
}

test pay_pool_under_decreased() fail {
  two_paid(
    two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total + 1),
    pairs_for(2),
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
  two_paid(Transaction { ..tx, outputs }, pairs_for(2))
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
  two_paid(Transaction { ..tx, outputs }, pairs_for(2))
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
    pairs_for(2),
  )
}

test pay_two_pool_outputs() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  two_paid(
    Transaction {
      ..tx,
      outputs: list.concat(tx.outputs, [mk_pool_output(pool_ada, 0)]),
    },
    pairs_for(2),
  )
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
  two_paid(Transaction { ..tx, outputs }, pairs_for(2))
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
    pairs_for(2),
  )
}

test pay_two_pairs_one_output() fail {
  two_paid(
    two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total),
    [PayPair(2, 2), PayPair(3, 2)],
  )
}

test pay_pairs_inputs_not_increasing() fail {
  two_paid(
    two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total),
    [PayPair(3, 2), PayPair(2, 3)],
  )
}

test pay_missing_pair() fail {
  two_paid(
    two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total),
    pairs_for(1),
  )
}

test pay_extra_pair() fail {
  two_paid(
    two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total),
    pairs_for(3),
  )
}

test pay_extra_deposit_input() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  two_paid(
    Transaction {
      ..tx,
      inputs: list.concat(tx.inputs, [mk_input(mk_outref(20), dep_in(3))]),
    },
    pairs_for(2),
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
    pairs_for(2),
  )
}

test pay_stale_exit_info() fail {
  let tx = two_paid_tx([dep_out(6, 0), dep_out(7, 0)], pool_night - two_total)
  run(
    tx,
    Pay {
      proof: proof(leaves7, 6, 7),
      pairs: pairs_for(2),
      exits: [ExitInfo(0, 0)],
    },
  )
}

// -- skim ----------------------------------------------------------------------------

fn skim_tx(skim: Int, tx_fee: Int) -> Transaction {
  Transaction {
    ..two_paid_tx([dep_out(6, skim), dep_out(7, skim)], pool_night - two_total),
    fee: tx_fee,
  }
}

test skim_at_fee_share_ok() {
  two_paid(skim_tx(3_000, 6_000), pairs_for(2))
}

test skim_above_fee_share() fail {
  two_paid(skim_tx(3_001, 6_000), pairs_for(2))
}

test skim_rounds_up() {
  two_paid(skim_tx(3_001, 6_001), pairs_for(2))
}

test skim_at_config_max_with_padded_fee() {
  two_paid(skim_tx(config.batcher_skim_max_lovelace, 5_000_000), pairs_for(2))
}

test skim_above_config_max_with_padded_fee() fail {
  two_paid(
    skim_tx(config.batcher_skim_max_lovelace + 1, 5_000_000),
    pairs_for(2),
  )
}

// -- exits -----------------------------------------------------------------------------

const exit_tree = tree(3)

const exit_root = build_root(exit_tree)

const exit_digest = Digest { ..digest5, root: exit_root }

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
    st(exit_root, k(1), k(3), False),
    st(exit_root, k(1), k(4), False),
    pool_night - amount(3),
    [dep, pred_in],
    [refund_output, pred_out],
    mint,
  )
}

fn run_exit(tx: Transaction) -> Bool {
  run(
    tx,
    Pay {
      proof: proof(exit_tree, 3, 4),
      pairs: [PayPair(2, 2)],
      exits: [ExitInfo(3, 3)],
    },
  )
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
        if i == 2 {
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

test exit_without_exit_info() fail {
  run(
    good_exit_tx(),
    Pay { proof: proof(exit_tree, 3, 4), pairs: [PayPair(2, 2)], exits: [] },
  )
}

test exit_leaf_paid_as_deposit() fail {
  // ack = 1 leaf with a continuing deposit output instead of a refund.
  let tx =
    batch_tx(
      st(exit_root, k(1), k(3), False),
      st(exit_root, k(1), k(4), False),
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
  run(tx, Pay { proof: proof(exit_tree, 3, 4), pairs: pairs_for(1), exits: [] })
}

test exit_predecessor_is_head_ok() {
  let t = tree(1)
  let r = build_root(t)
  let tx =
    batch_tx(
      st(r, k(4), k(1), False),
      st(r, k(4), k(2), False),
      pool_night - amount(1),
      [committed_dep(1, 0), mk_head_output(k(1))],
      [refund_out(dep_ada, amount(1)), mk_head_output(k(2))],
      from_asset(account_policy, builtin.append_bytearray(#"00", k(1)), -1),
    )
  run(
    tx,
    Pay {
      proof: proof(t, 1, 2),
      pairs: [PayPair(2, 2)],
      exits: [ExitInfo(3, 3)],
    },
  )
}

test exit_first_batch_ok() {
  let (mmr_root, dp) = digest_proof(exit_digest)
  let tx =
    batch_tx(
      init_state,
      st(exit_root, k(3), k(4), False),
      pool_night - amount(3),
      [committed_dep(3, 0), mk_deposit_output(k(2), dep_ada, 0, k(3), None)],
      [
        refund_out(dep_ada, amount(3)),
        mk_deposit_output(k(2), dep_ada, 0, k(4), None),
      ],
      exit_burn,
    )
      |> with_bridge(mmr_root)
  run(
    tx,
    LoadAndPay {
      digest_proof: dp,
      proof: proof(exit_tree, 3, 4),
      pairs: [PayPair(2, 2)],
      exits: [ExitInfo(3, 3)],
    },
  )
}

// -- budget ------------------------------------------------------------------------------

const big_n = 64

const big_tree = list.map(list.range(1, big_n), fn(i) { leaf_bytes(0, i) })

const big_root = build_root(big_tree)

fn big_state(cursor: ByteArray, complete: Bool) -> BatcherState {
  BatcherState {
    ..st(big_root, k(1), cursor, complete),
    min_key: k(1),
    max_key: k(big_n),
  }
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
  Pay { proof: build_proof(big_tree, 0, 30), pairs: pairs_for(30), exits: [] }
}

/// Fixture cost alone; subtract from `budget_30_pairs` for the validator's share.
test budget_30_pairs_fixture_only() {
  let tx = budget_tx()
  expect Pay { proof, pairs, .. } = budget_redeemer()
  and {
    list.length(tx.inputs) == 32,
    list.length(proof) == 2,
    list.length(pairs) == 30,
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

fn with_treasury(state: BatcherState) -> BatcherState {
  BatcherState { ..state, treasury_total: treasury }
}

/// The last batch of the k4 fold, with the pool paying `pool_paid` beyond the leaves and `extra` outputs appended.
fn completing(pool_paid: Int, extra: List<Output>) -> Bool {
  let tx =
    batch_tx(
      with_treasury(st(root7, k(4), k(2), False)),
      with_treasury(st(root7, k(4), k(4), True)),
      pool_night - sum_amounts([2, 3]) - pool_paid,
      [dep_in(2), dep_in(3)],
      [dep_out(2, 0), dep_out(3, 0)],
      zero,
    )
  run(
    Transaction { ..tx, outputs: list.concat(tx.outputs, extra) },
    Pay { proof: proof(leaves7, 2, 4), pairs: pairs_for(2), exits: [] },
  )
}

test treasury_paid_by_completing_batch() {
  completing(treasury, [ics_output(treasury)])
}

test treasury_missing_ics_output() fail {
  completing(treasury, [])
}

test treasury_ics_underpaid() fail {
  completing(treasury, [ics_output(treasury - 1)])
}

test treasury_left_in_pool() fail {
  completing(0, [ics_output(treasury)])
}

test treasury_ics_output_with_datum_hash() fail {
  completing(
    treasury,
    [Output { ..ics_output(treasury), datum: DatumHash(zero32) }],
  )
}

test treasury_ics_output_extra_asset() fail {
  let out = ics_output(treasury)
  completing(
    treasury,
    [Output { ..out, value: out.value |> add(batcher_hash, "x", 1) }],
  )
}

test treasury_ics_output_with_stake_part() fail {
  let staked =
    Address(
      Script(config.ics_forever_hash),
      Some(Inline(VerificationKey(zero28))),
    )
  completing(treasury, [Output { ..ics_output(treasury), address: staked }])
}

test treasury_not_paid_mid_fold() fail {
  let tx =
    batch_tx(
      with_treasury(st(root7, k(4), k(6), False)),
      with_treasury(st(root7, k(4), k(1), False)),
      pool_night - two_total - treasury,
      [dep_in(6), dep_in(7)],
      [dep_out(6, 0), dep_out(7, 0)],
      zero,
    )
  run(
    Transaction {
      ..tx,
      outputs: list.concat(tx.outputs, [ics_output(treasury)]),
    },
    Pay { proof: proof(leaves7, 6, 7), pairs: pairs_for(2), exits: [] },
  )
}

test treasury_paid_by_load_that_completes() {
  let all = [1, 2, 3, 4, 5, 6, 7]
  let (mmr_root, dp) =
    digest_proof(Digest { ..digest5, treasury_total: treasury })
  let tx =
    batch_tx(
      init_state,
      with_treasury(st(root7, k(1), k(1), True)),
      pool_night - sum_amounts(all) - treasury,
      list.map(all, dep_in),
      list.map(all, fn(i) { dep_out(i, 0) }),
      zero,
    )
      |> with_bridge(mmr_root)
  run(
    Transaction {
      ..tx,
      outputs: list.concat(tx.outputs, [ics_output(treasury)]),
    },
    LoadAndPay {
      digest_proof: dp,
      proof: proof(leaves7, 1, 7),
      pairs: pairs_for(7),
      exits: [],
    },
  )
}

/// An empty-epoch load whose digest carries a Treasury share; the pool pays `pool_paid`.
fn empty_treasury(pool_paid: Int, extra: List<Output>) -> Bool {
  let (mmr_root, dp) =
    digest_proof(Digest { ..empty_digest, treasury_total: treasury })
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        mk_input(mk_outref(1), mk_state_output(init_state)),
        mk_input(mk_outref(2), mk_pool_output(pool_ada, pool_night)),
      ],
      outputs: [
        mk_state_output(with_treasury(BatcherState { ..init_state, epoch: 5 })),
        mk_pool_output(pool_ada, pool_night - pool_paid),
        ..extra
      ],
      fee,
      withdrawals: [withdrawal_of(batcher_hash)],
    }
      |> with_bridge(mmr_root)
  run(tx, LoadAndPay { digest_proof: dp, proof: [], pairs: [], exits: [] })
}

test treasury_paid_by_empty_epoch_load() {
  empty_treasury(treasury, [ics_output(treasury)])
}

test treasury_empty_epoch_without_ics_output() fail {
  empty_treasury(treasury, [])
}

test treasury_empty_epoch_left_in_pool() fail {
  empty_treasury(0, [ics_output(treasury)])
}

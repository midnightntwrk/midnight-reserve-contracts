//// Withdraw logic of the `rewards_batcher` validator (spec §5). One
//// verification per transaction: the state NFT input and output, one sorted
//// multiproof, then a linear pass over the paid leaves and their indexed
//// deposit inputs and outputs.
////
//// A run is `[cursor, …, lookahead]`: every leaf up to the lookahead is
//// paid; the lookahead is the next cursor. A run whose last leaf is
//// `max_key` pays it and wraps the cursor to `min_key`. A lookahead equal
//// to `start_key` closes the epoch. So an epoch completes in the same batch
//// that pays its last leaf and no batch can be empty.

use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use aiken/math
use bridge/types.{BeefyConsensusState, ProofNodeRec} as bridge_types
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId, Value, add, from_asset}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use rewards/digest.{verify_digest}
use rewards/linked_list.{deposit_name, unlink}
use rewards/merkle_range.{RewardLeaf, parse_leaf, verify_range}
use rewards/types.{
  AccountDatum, BatcherRedeemer, BatcherState, Deposit, Digest, DigestProof,
  ExitInfo, LoadAndPay, Pay, PayPair,
}
use rewards/value.{quantity, split_ada, tokens_of}
use utils.{
  get_input_state_by_policy, get_output_state_by_policy, input_linked_mint,
}

/// One-shot mint of the state NFT: 28-byte hashes, `complete == True`.
pub fn init_state(
  tx: Transaction,
  own_policy: PolicyId,
  one_shot_ref: OutputReference,
) -> Bool {
  let Transaction { inputs, outputs, mint, .. } = tx
  let datum = input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)
  expect BatcherState { account_policy, pool_forever, complete, .. }: BatcherState =
    datum
  and {
    builtin.length_of_bytearray(account_policy) == 28,
    builtin.length_of_bytearray(pool_forever) == 28,
    complete,
  }
}

/// Spend gate of the state UTXO: the own withdrawal exists.
pub fn spend_gate(
  withdrawals: Pairs<Credential, Int>,
  own_hash: ScriptHash,
) -> Bool {
  let own = Script(own_hash)
  list.any(withdrawals, fn(w) { w.1st == own })
}

pub fn validate(tx: Transaction, own_hash: ScriptHash, redeemer: Data) -> Bool {
  expect redeemer: BatcherRedeemer = redeemer
  expect state_in: BatcherState = get_input_state_by_policy(tx.inputs, own_hash)
  expect state_out: BatcherState =
    get_output_state_by_policy(tx.outputs, own_hash)
  when redeemer is {
    Pay { proof, pairs, exits } -> {
      expect !state_in.complete
      pay(state_in, leaves(state_in.root, proof), pairs, exits, tx) == state_out
    }
    LoadAndPay { digest_proof, proof, pairs, exits } -> {
      expect state_in.complete
      let Digest { epoch, leaf_count, root, min_key, max_key } =
        load(state_in, digest_proof, tx.reference_inputs)
      let loaded = BatcherState { ..state_in, epoch, root, min_key, max_key }
      if leaf_count == 0 {
        expect proof == [] && pairs == [] && exits == []
        expect account_inputs(tx.inputs, state_in.account_policy) == 0
        expect pool_inputs(tx.inputs, state_in.pool_forever) == assets.zero
        loaded == state_out
      } else {
        let leaves = leaves(root, proof)
        expect [first, ..] = leaves
        let opened =
          BatcherState { ..loaded, start_key: first.key, cursor: first.key }
        pay(opened, leaves, pairs, exits, tx) == state_out
      }
    }
  }
}

/// The digest of `state.epoch + 1`, proven against the bridge's latest MMR root.
pub fn load(
  state: BatcherState,
  digest_proof: DigestProof,
  reference_inputs: List<Input>,
) -> Digest {
  expect BeefyConsensusState { latest_mmr_root, .. }: BeefyConsensusState =
    get_input_state_by_policy(
      reference_inputs,
      config.committee_bridge_forever_hash,
    )
  let digest = verify_digest(latest_mmr_root, digest_proof)
  expect digest.epoch == state.epoch + 1
  digest
}

/// Verified leaves of one contiguous run, in ascending order.
pub fn leaves(root: ByteArray, proof: ProofNodeRec) -> List<RewardLeaf> {
  verify_range(root, proof) |> list.map(parse_leaf)
}

/// Apply one batch to `state` and return the resulting state.
pub fn pay(
  state: BatcherState,
  leaves: List<RewardLeaf>,
  pairs: List<PayPair>,
  exits: List<ExitInfo>,
  tx: Transaction,
) -> BatcherState {
  let Transaction { inputs, outputs, mint, fee, .. } = tx
  let paid, cursor <- split_run(state, leaves)
  let n_paid = list.length(paid)
  let cap =
    math.min(( fee + n_paid - 1 ) / n_paid, config.batcher_skim_max_lovelace)
  let env =
    Env {
      inputs,
      outputs,
      account_policy: state.account_policy,
      burned: tokens_of(mint, state.account_policy),
      cap,
    }
  let total = pay_each(paid, pairs, exits, -1, -1, 0, env)
  expect
    account_inputs(inputs, state.account_policy) == n_paid + list.length(exits)
  expect pool_ok(inputs, outputs, state.pool_forever, total)
  BatcherState { ..state, cursor, complete: cursor == state.start_key }
}

/// Split an ascending run starting at `state.cursor` into the paid leaves and the next cursor.
pub fn split_run(
  state: BatcherState,
  leaves: List<RewardLeaf>,
  return: fn(List<RewardLeaf>, ByteArray) -> result,
) -> result {
  expect [head, ..] = leaves
  expect head.key == state.cursor
  take_run(leaves, state, return)
}

/// `leaves` is non-empty and its head is paid.
fn take_run(
  leaves: List<RewardLeaf>,
  state: BatcherState,
  return: fn(List<RewardLeaf>, ByteArray) -> result,
) -> result {
  when leaves is {
    [x] -> {
      expect x.key == state.max_key
      return([x], state.min_key)
    }
    [x, y, ..more] ->
      if y.key == state.start_key {
        expect more == []
        return([x], y.key)
      } else if more == [] && y.key != state.max_key {
        return([x], y.key)
      } else {
        let paid, cursor <- take_run([y, ..more], state)
        return([x, ..paid], cursor)
      }
    [] -> fail
  }
}

type Env {
  inputs: List<Input>,
  outputs: List<Output>,
  account_policy: PolicyId,
  burned: Pairs<ByteArray, Int>,
  cap: Int,
}

/// Check every paid leaf against its `PayPair` (and `ExitInfo` for an exit); returns the NIGHT paid.
fn pay_each(
  paid: List<RewardLeaf>,
  pairs: List<PayPair>,
  exits: List<ExitInfo>,
  prev_in: Int,
  prev_out: Int,
  total: Int,
  env: Env,
) -> Int {
  when paid is {
    [] -> {
      expect pairs == [] && exits == []
      total
    }
    [leaf, ..rest] -> {
      expect [PayPair { input_index, output_index }, ..pairs] = pairs
      expect input_index > prev_in && output_index > prev_out
      expect Some(input) = list.at(env.inputs, input_index)
      expect Some(output) = list.at(env.outputs, output_index)
      let name = deposit_name(leaf.key)
      expect [Pair(in_name, 1)] =
        tokens_of(input.output.value, env.account_policy)
      expect in_name == name
      expect InlineDatum(datum) = input.output.datum
      expect Deposit { next, committed, .. }: AccountDatum = datum
      let ada_in, _ <- split_ada(input.output.value)
      let night_in = night_of(input.output.value)
      let ada_out, out_assets <- split_ada(output.value)
      expect ada_in - ada_out <= env.cap
      let night_due = night_in + leaf.amount
      let exits =
        if leaf.ack == 0 {
          expect output.address == input.output.address
          expect output.datum == input.output.datum
          expect
            out_assets == deposit_assets(env.account_policy, name, night_due)
          exits
        } else {
          expect leaf.ack == 1
          expect Some(refund_address) = committed
          expect [ExitInfo { pred_input_index, pred_output_index }, ..exits] =
            exits
          expect Some(pred) = list.at(env.inputs, pred_input_index)
          expect Some(pred_out) = list.at(env.outputs, pred_output_index)
          expect unlink(pred, pred_out, env.account_policy, leaf.key, next)
          expect output.address == refund_address
          expect night_of(output.value) >= night_due
          expect quantity(env.burned, name) == -1
          exits
        }
      pay_each(
        rest,
        pairs,
        exits,
        input_index,
        output_index,
        total + leaf.amount,
        env,
      )
    }
  }
}

/// Inputs at the pool address never carry the forever NFT; exactly one
/// `[ada, night]` output with inline datum, NIGHT down by `total`, ADA not down.
fn pool_ok(
  inputs: List<Input>,
  outputs: List<Output>,
  pool_forever: ScriptHash,
  total: Int,
) -> Bool {
  let pool_cred = Script(pool_forever)
  let pool_in = pool_inputs(inputs, pool_forever)
  expect [pool_out] =
    list.filter(outputs, fn(o) { o.address.payment_credential == pool_cred })
  let ada_out, out_assets <- split_ada(pool_out.value)
  expect InlineDatum(_) = pool_out.datum
  and {
    ada_out >= assets.lovelace_of(pool_in),
    out_assets == night_assets(night_of(pool_in) - total),
  }
}

/// Sum of the inputs at the pool address; fails if any carries the forever NFT.
fn pool_inputs(inputs: List<Input>, pool_forever: ScriptHash) -> Value {
  let pool_cred = Script(pool_forever)
  list.foldl(
    inputs,
    assets.zero,
    fn(input, acc) {
      let Output { address, value, .. } = input.output
      if address.payment_credential == pool_cred {
        expect assets.quantity_of(value, pool_forever, "") == 0
        assets.merge(value, acc)
      } else {
        acc
      }
    },
  )
}

fn account_inputs(inputs: List<Input>, account_policy: PolicyId) -> Int {
  list.count(
    inputs,
    fn(input) { tokens_of(input.output.value, account_policy) != [] },
  )
}

fn night_of(value: Value) -> Int {
  tokens_of(value, config.cnight_policy) |> quantity(config.cnight_name)
}

fn night_assets(amount: Int) -> Data {
  from_asset(config.cnight_policy, config.cnight_name, amount)
    |> assets.to_dict
    |> dict.to_pairs
    |> as_data
}

/// Non-ADA part of a deposit: its NFT plus `night` NIGHT.
fn deposit_assets(account_policy: PolicyId, name: ByteArray, night: Int) -> Data {
  from_asset(account_policy, name, 1)
    |> add(config.cnight_policy, config.cnight_name, night)
    |> assets.to_dict
    |> dict.to_pairs
    |> as_data
}

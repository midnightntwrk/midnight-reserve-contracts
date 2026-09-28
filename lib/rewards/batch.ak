//// Withdraw logic of the `rewards_batcher` validator (spec §5). `Load`
//// takes the next epoch's digest from the bridge and pays its Treasury
//// share from the pool to the ICS; the fold then starts at the digest's
//// `min_key`. `Pay` reveals one contiguous run `[cursor, …, lookahead]` with
//// a sorted multiproof, pays every leaf before the lookahead, and moves the
//// cursor to it; the run that pays `max_key` has no lookahead and completes
//// the epoch.
////
//// A `Pay` is one fold over the paid leaves, the account mint, the account
//// inputs sorted by name and the outputs after the pool output. Going
//// forward, each leaf takes its items from the four lists; the mint and the
//// inputs must end empty, so every account input, burn and output has
//// exactly one role. Coming back, each leaf gets its successor's `Relink`
//// (the successor exits and names the `next` its predecessor takes) and
//// checks its outputs with it: a paid deposit takes the relink in its one
//// output, an exit passes it on to its own predecessor.
////
//// Outputs: 0 the state, 1 the pool, then (`Pay`) per paid leaf in leaf
//// order its deposit (`ack = 0`), or for an exit (`ack = 1`) its
//// predecessor (only when that is not the previous paid leaf) and its
//// refund; or (`Load` with a Treasury share) the ICS output.

use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use aiken/math
use aiken/primitive/bytearray
use bridge/types.{BeefyConsensusState, ProofNodeRec} as bridge_types
use cardano/address.{Address, Credential, Script}
use cardano/assets.{AssetName, PolicyId, Value, add, from_asset}
use cardano/transaction.{
  DatumHash, InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use rewards/digest.{verify_digest}
use rewards/linked_list.{deposit_name, unlink}
use rewards/merkle_range.{RewardLeaf, parse_leaf, verify_range}
use rewards/types.{
  AccountDatum, BatcherRedeemer, BatcherState, Deposit, Digest, DigestProof,
  Load, Pay,
}
use rewards/value.{quantity, split_ada, tokens_of}
use utils.{
  get_input_state_by_policy, input_linked_mint, is_singleton, must_find,
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
  let state_input =
    must_find(tx.inputs, fn(i) { is_singleton(i.output.value, own_hash, "") }).output
  expect [state_output, ..outputs] = tx.outputs
  expect InlineDatum(state_in_data) = state_input.datum
  expect state_in: BatcherState = state_in_data
  expect InlineDatum(state_out_data) = state_output.datum
  expect state_out: BatcherState = state_out_data
  expect and {
      state_output.address == state_input.address,
      is_singleton(state_output.value, own_hash, ""),
    }
  when redeemer is {
    Load { digest_proof } -> {
      expect state_in.complete
      let Digest { epoch, leaf_count, root, min_key, max_key, treasury_total } =
        load(state_in, digest_proof, tx.reference_inputs)
      expect and {
          account_inputs(tx.inputs, state_in.account_policy) == 0,
          tokens_of(tx.mint, state_in.account_policy) == [],
        }
      expect
        if treasury_total == 0 {
          pool_inputs(tx.inputs, state_in.pool_forever) == assets.zero
        } else {
          expect [pool_out, ics_out, ..] = outputs
          and {
            pool_ok(tx.inputs, pool_out, state_in.pool_forever, treasury_total),
            ics_ok(tx.inputs, ics_out, treasury_total),
          }
        }
      state_out == BatcherState {
        ..state_in,
        epoch,
        root,
        max_key,
        cursor: min_key,
        complete: leaf_count == 0,
      }
    }
    Pay { proof } -> {
      expect !state_in.complete
      pay(state_in, leaves(state_in.root, proof), outputs, tx) == state_out
    }
  }
}

/// The digest of `state.epoch + 1`, proven against the bridge's latest MMR root.
pub fn load(
  state: BatcherState,
  digest_proof: DigestProof,
  reference_inputs: List<Input>,
) -> Digest {
  expect BeefyConsensusState { latest_mmr_root, latest_height, .. }: BeefyConsensusState =
    get_input_state_by_policy(
      reference_inputs,
      config.committee_bridge_forever_hash,
    )
  let digest = verify_digest(latest_mmr_root, latest_height, digest_proof)
  expect digest.epoch == state.epoch + 1
  digest
}

/// Verified leaves of one contiguous run, in ascending order.
pub fn leaves(root: ByteArray, proof: ProofNodeRec) -> List<RewardLeaf> {
  verify_range(root, proof) |> list.map(parse_leaf)
}

/// Apply one batch to `state`; `outputs` follow the state output.
pub fn pay(
  state: BatcherState,
  leaves: List<RewardLeaf>,
  outputs: List<Output>,
  tx: Transaction,
) -> BatcherState {
  let Transaction { inputs, mint, fee, .. } = tx
  let paid, next <- split_run(state, leaves)
  let n_paid = list.length(paid)
  let env =
    Env {
      account_policy: state.account_policy,
      cap: math.min(
        ( fee + n_paid - 1 ) / n_paid,
        config.batcher_skim_max_lovelace,
      ),
    }
  expect [pool_out, ..outputs] = outputs
  let (total, relink) =
    pay_fold(
      paid,
      tokens_of(mint, state.account_policy),
      sorted_account_inputs(inputs, state.account_policy),
      outputs,
      env,
    )
  expect relink == None
  expect pool_ok(inputs, pool_out, state.pool_forever, total)
  when next is {
    Some(cursor) -> BatcherState { ..state, cursor }
    None -> BatcherState { ..state, complete: True }
  }
}

/// Split an ascending run starting at `state.cursor` into the paid leaves and the next cursor, `None` when the run pays `max_key`.
pub fn split_run(
  state: BatcherState,
  leaves: List<RewardLeaf>,
  return: fn(List<RewardLeaf>, Option<ByteArray>) -> result,
) -> result {
  expect [head, ..] = leaves
  expect head.key == state.cursor
  take_run(leaves, state.max_key, return)
}

/// `leaves` is non-empty and its head is paid; `max_key` is never the lookahead.
fn take_run(
  leaves: List<RewardLeaf>,
  max_key: ByteArray,
  return: fn(List<RewardLeaf>, Option<ByteArray>) -> result,
) -> result {
  when leaves is {
    [x] -> {
      expect x.key == max_key
      return([x], None)
    }
    [x, y, ..more] ->
      if more == [] && y.key != max_key {
        return([x], Some(y.key))
      } else {
        let paid, next <- take_run([y, ..more], max_key)
        return([x, ..paid], next)
      }
    [] -> fail
  }
}

type Env {
  account_policy: PolicyId,
  cap: Int,
}

/// The inputs carrying an account NFT, as `(name, input)` sorted by name, so deposits come in leaf order.
fn sorted_account_inputs(
  inputs: List<Input>,
  account_policy: PolicyId,
) -> List<(ByteArray, Input)> {
  list.foldr(
    inputs,
    [],
    fn(input, acc) {
      when tokens_of(input.output.value, account_policy) is {
        [] -> acc
        tokens -> {
          expect [Pair(name, 1)] = tokens
          [(name, input), ..acc]
        }
      }
    },
  )
    |> list.sort(fn(a, b) { bytearray.compare(a.1st, b.1st) })
}

/// An exit asks the node before it in the list for `next := next`, past the exiting `removed`.
type Relink {
  removed: ByteArray,
  next: ByteArray,
}

/// Forward: each paid leaf takes its inputs, its burn (an exit) and its outputs. Back: each checks them with its successor's relink. Returns the NIGHT paid and the relink for the node before the run.
fn pay_fold(
  leaves: List<RewardLeaf>,
  burns: Pairs<AssetName, Int>,
  inputs: List<(AssetName, Input)>,
  outputs: List<Output>,
  env: Env,
) -> (Int, Option<Relink>) {
  when leaves is {
    [] -> {
      expect burns == [] && inputs == []
      (0, None)
    }
    [leaf, ..leaves] -> {
      let name = deposit_name(leaf.key)
      expect [(first_name, first), ..inputs] = inputs
      if leaf.ack == 0 {
        expect [out, ..outputs] = outputs
        let (total, relink) = pay_fold(leaves, burns, inputs, outputs, env)
        expect and {
            first_name == name,
            paid_ok(first, out, name, leaf.amount, relink, env),
          }
        (total + leaf.amount, None)
      } else {
        expect leaf.ack == 1
        expect [Pair(burned, -1), ..burns] = burns
        expect burned == name
        if first_name == name {
          // The predecessor is the previous paid leaf; it takes the relink.
          expect [refund, ..outputs] = outputs
          let (total, relink) = pay_fold(leaves, burns, inputs, outputs, env)
          let next = exit_ok(first, refund, leaf, relink, env)
          (total + leaf.amount, Some(Relink { removed: leaf.key, next }))
        } else {
          expect [(found, deposit), ..inputs] = inputs
          expect found == name
          expect [pred_out, refund, ..outputs] = outputs
          let (total, relink) = pay_fold(leaves, burns, inputs, outputs, env)
          let next = exit_ok(deposit, refund, leaf, relink, env)
          expect unlink(first, pred_out, env.account_policy, leaf.key, next)
          (total + leaf.amount, None)
        }
      }
    }
  }
}

/// `next` after the batch: unchanged, or past the exiting successor that asked.
fn relinked(next: ByteArray, relink: Option<Relink>) -> ByteArray {
  when relink is {
    None -> next
    Some(Relink { removed, next: new_next }) -> {
      expect next == removed
      new_next
    }
  }
}

/// The deposit continues at its address with its NFT, `amount` more NIGHT and its datum (relinked when its successor exits); its ADA does not rise and falls by at most the skim cap.
fn paid_ok(
  deposit: Input,
  out: Output,
  name: AssetName,
  amount: Int,
  relink: Option<Relink>,
  env: Env,
) -> Bool {
  let Output { address, value, datum, .. } = deposit.output
  let ada_in, _ <- split_ada(value)
  let ada_out, out_assets <- split_ada(out.value)
  and {
    ada_out <= ada_in,
    ada_in - ada_out <= env.cap,
    out.address == address,
    out.datum == when relink is {
      None -> datum
      Some(_) -> {
        expect InlineDatum(data) = datum
        expect Deposit { cred, next, committed }: AccountDatum = data
        InlineDatum(Deposit { cred, next: relinked(next, relink), committed })
      }
    },
    out_assets == deposit_assets(
      env.account_policy,
      name,
      night_of(value) + amount,
    ),
  }
}

/// The exiting deposit's ADA (no more, and less at most the skim cap) and NIGHT plus the leaf amount go to its committed refund address; returns the `next` its predecessor takes.
fn exit_ok(
  deposit: Input,
  refund: Output,
  leaf: RewardLeaf,
  relink: Option<Relink>,
  env: Env,
) -> ByteArray {
  let Output { value, datum, .. } = deposit.output
  expect InlineDatum(data) = datum
  expect Deposit { next, committed: Some(refund_address), .. }: AccountDatum =
    data
  let ada_in, _ <- split_ada(value)
  let ada_out, _ <- split_ada(refund.value)
  expect and {
      refund.address == refund_address,
      ada_out <= ada_in,
      ada_in - ada_out <= env.cap,
      night_of(refund.value) >= night_of(value) + leaf.amount,
    }
  relinked(next, relink)
}

/// The pool pays `amount`: its inputs, none with the forever NFT, continue as `out` at the pool address with an inline datum, NIGHT down by `amount` and ADA not down.
fn pool_ok(
  inputs: List<Input>,
  out: Output,
  pool_forever: ScriptHash,
  amount: Int,
) -> Bool {
  let pool_in = pool_inputs(inputs, pool_forever)
  let ada_out, out_assets <- split_ada(out.value)
  expect InlineDatum(_) = out.datum
  and {
    out.address == Address(Script(pool_forever), None),
    ada_out >= assets.lovelace_of(pool_in),
    out_assets == night_assets(night_of(pool_in) - amount),
  }
}

/// No input at the ICS, so no ICS merge shares the transaction; `out` pays exactly `amount` NIGHT to the ICS forever address as `[ada, night]` without a datum hash.
fn ics_ok(inputs: List<Input>, out: Output, amount: Int) -> Bool {
  let ics = Script(config.ics_forever_hash)
  let _, out_assets <- split_ada(out.value)
  and {
    list.all(inputs, fn(i) { i.output.address.payment_credential != ics }),
    out.address == Address(ics, None),
    out_assets == night_assets(amount),
    when out.datum is {
      DatumHash(_) -> False
      _ -> True
    },
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

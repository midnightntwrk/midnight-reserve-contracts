//// User logic of the `virtual_account` validator (spec §3, §4). It runs once
//// per transaction in the withdraw handler; mint and spend only gate on the
//// authority named by their redeemer. One action kind per tx, applied to
//// every account-address input; outputs from `offset` match them 1:1.

use aiken/builtin
use aiken/collection/list
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use rewards/auth.{stake_auth}
use rewards/fold.{Fold2, foldl2}
use rewards/linked_list.{
  deposit_name, init_list, insert_ascending, key, registration_name,
}
use rewards/types.{
  AccountAction, AccountDatum, Batcher, Deposit, InitList, Register,
  Registration, SetDeregister, TopUp, UpdateRegistration, User, Withdraw,
}
use rewards/value.{claim, only_nft, quantity, split_ada, tokens_of}

/// Spend and mint gate: the withdrawal of the authority named by the redeemer exists.
pub fn account_gate(
  withdrawals: Pairs<Credential, Int>,
  own_hash: PolicyId,
  redeemer: Data,
) -> Bool {
  let authority =
    if redeemer == as_data(User) {
      Script(own_hash)
    } else if redeemer == as_data(Batcher) {
      Script(config.rewards_batcher_hash)
    } else {
      fail @"unknown gate"
    }
  list.any(withdrawals, fn(w) { w.1st == authority })
}

pub fn account_withdraw(
  tx: Transaction,
  own_hash: PolicyId,
  redeemer: Data,
) -> Bool {
  expect AccountAction { kind, offset }: AccountAction = redeemer
  let Transaction { inputs, outputs, mint, extra_signatories, withdrawals, .. } =
    tx
  expect own_hash != config.cnight_policy
  let own_address = Script(own_hash)
  let outs = list.drop(outputs, offset)
  let minted = tokens_of(mint, own_hash)
  let auth =
    fn(cred) { stake_auth(cred, extra_signatories, withdrawals) }

  if kind == InitList {
    expect !list.any(inputs, fn(i) { is_own(i, own_address) })
    expect [head, tail, ..] = outs
    init_list(
      inputs,
      mint,
      head,
      tail,
      own_hash,
      OutputReference(
        config.virtual_account_one_shot_hash,
        config.virtual_account_one_shot_index,
      ),
    )
  } else if kind == Register {
    let
      _,
      unclaimed,
    <-
      fold_own2(
        inputs,
        own_address,
        outs,
        minted,
        fn(anchor, remaining, unclaimed, return) {
          expect [anchor_out, node, registration, ..rest] = remaining
          let cred = insert_ascending(anchor, anchor_out, node, own_hash)
          let skh = key(cred)
          let dep = deposit_name(skh)
          let reg = registration_name(skh)
          expect auth(cred)
          let (ada, node_assets) = split_ada(node.value)
          expect node_assets == only_nft(own_hash, dep)
          expect
            ada >= config.deposit_min_lovelace && ada <= config.deposit_cap_lovelace
          let (_, registration_assets) = split_ada(registration.value)
          expect registration.address.payment_credential == own_address
          expect registration_assets == only_nft(own_hash, reg)
          expect registration_ok(registration)
          return(rest, unclaimed |> claim(dep, 1) |> claim(reg, 1))
        },
      )
    unclaimed == []
  } else if kind == Withdraw {
    expect minted == []
    each_deposit(
      inputs,
      outs,
      own_hash,
      fn(input, cred, name, out) {
        expect auth(cred)
        let (ada_in, _) = split_ada(input.output.value)
        let (ada_out, out_assets) = split_ada(out.value)
        and {
          out.datum == input.output.datum,
          out_assets == only_nft(own_hash, name),
          ada_out == ada_in,
        }
      },
    )
  } else if kind == TopUp {
    expect minted == []
    each_deposit(
      inputs,
      outs,
      own_hash,
      fn(input, cred, _name, out) {
        expect auth(cred)
        let (ada_in, in_assets) = split_ada(input.output.value)
        let (ada_out, out_assets) = split_ada(out.value)
        and {
          out.datum == input.output.datum,
          out_assets == in_assets,
          ada_out - ada_in >= config.deposit_min_lovelace,
          ada_out <= config.deposit_cap_lovelace,
        }
      },
    )
  } else if kind == SetDeregister {
    // Deposits pop one output each and claim their registration's burn;
    // registration inputs pop nothing and must be burned. Every burn must
    // be claimed, and a burn needs its NFT input, so the pairing is exact.
    let
      _,
      unclaimed,
    <-
      fold_own2(
        inputs,
        own_address,
        outs,
        minted,
        fn(input, remaining, unclaimed, return) {
          expect [Pair(name, 1)] = tokens_of(input.output.value, own_hash)
          expect InlineDatum(datum) = input.output.datum
          if builtin.index_bytearray(name, 0) == 0 {
            expect Deposit { cred, next, committed: None }: AccountDatum = datum
            let skh = key(cred)
            expect name == deposit_name(skh)
            expect auth(cred)
            expect [out, ..rest] = remaining
            expect out.address == input.output.address
            expect out.value == input.output.value
            expect InlineDatum(out_datum) = out.datum
            expect Deposit {
              cred: out_cred,
              next: out_next,
              committed: Some(_),
            }: AccountDatum = out_datum
            expect out_cred == cred && out_next == next
            return(rest, claim(unclaimed, registration_name(skh), -1))
          } else {
            expect builtin.index_bytearray(name, 0) == 1
            expect Registration { owner, .. }: AccountDatum = datum
            expect quantity(minted, name) == -1
            expect auth(owner)
            return(remaining, unclaimed)
          }
        },
      )
    unclaimed == []
  } else if kind == UpdateRegistration {
    expect minted == []
    each_own(
      inputs,
      own_address,
      outs,
      fn(input, out) {
        expect [Pair(name, 1)] = tokens_of(input.output.value, own_hash)
        expect builtin.index_bytearray(name, 0) == 1
        expect InlineDatum(datum) = input.output.datum
        expect Registration { owner, .. }: AccountDatum = datum
        expect auth(owner)
        let (_, out_assets) = split_ada(out.value)
        and {
          out.address == input.output.address,
          out_assets == only_nft(own_hash, name),
          registration_ok(out),
        }
      },
    )
  } else {
    fail @"unknown action"
  }
}

fn is_own(input: Input, own_address: Credential) -> Bool {
  input.output.address.payment_credential == own_address
}

/// Fold over the inputs at the account address, in ledger order.
fn fold_own(
  inputs: List<Input>,
  own_address: Credential,
  zero: acc,
  with: fn(Input, acc) -> acc,
) -> acc {
  list.foldl(
    inputs,
    zero,
    fn(input, acc) {
      if is_own(input, own_address) {
        with(input, acc)
      } else {
        acc
      }
    },
  )
}

/// `fold_own` with two accumulators.
fn fold_own2(
  inputs: List<Input>,
  own_address: Credential,
  zero_a: a,
  zero_b: b,
  with: fn(Input, a, b, Fold2<a, b, result>) -> result,
  return: Fold2<a, b, result>,
) -> result {
  foldl2(
    inputs,
    zero_a,
    zero_b,
    fn(input, acc_a, acc_b, next) {
      if is_own(input, own_address) {
        with(input, acc_a, acc_b, next)
      } else {
        next(acc_a, acc_b)
      }
    },
    return,
  )
}

/// Run `check` on every own input with its 1:1 output.
fn each_own(
  inputs: List<Input>,
  own_address: Credential,
  outs: List<Output>,
  check: fn(Input, Output) -> Bool,
) -> Bool {
  expect _ =
    fold_own(
      inputs,
      own_address,
      outs,
      fn(input, remaining) {
        expect [out, ..rest] = remaining
        expect check(input, out)
        rest
      },
    )
  True
}

/// `each_own` for deposit inputs: NFT first, then the datum.
fn each_deposit(
  inputs: List<Input>,
  outs: List<Output>,
  own_hash: PolicyId,
  check: fn(Input, Credential, ByteArray, Output) -> Bool,
) -> Bool {
  each_own(
    inputs,
    Script(own_hash),
    outs,
    fn(input, out) {
      expect [Pair(name, 1)] = tokens_of(input.output.value, own_hash)
      expect builtin.index_bytearray(name, 0) == 0
      expect InlineDatum(datum) = input.output.datum
      expect Deposit { cred, .. }: AccountDatum = datum
      expect name == deposit_name(key(cred))
      expect out.address == input.output.address
      check(input, cred, name, out)
    },
  )
}

fn registration_ok(out: Output) -> Bool {
  expect InlineDatum(datum) = out.datum
  expect Registration { dust_address, .. }: AccountDatum = datum
  builtin.length_of_bytearray(dust_address) <= 33
}

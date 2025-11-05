use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{AssetName, PolicyId, Value, to_dict}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}

pub fn must_find_key(pairs: Pairs<ByteArray, a>, key: ByteArray) -> a {
  expect [item, ..rest] = pairs

  if ( item |> builtin.fst_pair ) == key {
    item |> builtin.snd_pair
  } else {
    must_find_key(rest, key)
  }
}

pub fn must_find(list: List<a>, finder: fn(a) -> Bool) -> a {
  expect [x, ..rest] = list

  if finder(x) {
    x
  } else {
    must_find(rest, finder)
  }
}

type Fold2<a, b, result> =
  fn(a, b) -> result

pub fn foldr2(
  self: List<elem>,
  zero_a: a,
  zero_b: b,
  with: fn(elem, a, b, Fold2<a, b, result>) -> result,
  return: Fold2<a, b, result>,
) -> result {
  when self is {
    [] -> return(zero_a, zero_b)
    [x, ..xs] -> {
      let acc_a, acc_b <- foldr2(xs, zero_a, zero_b, with)

      with(x, acc_a, acc_b, return)
    }
  }
}

pub fn get_output_state_by_policy(outputs: List<Output>, policy: PolicyId) {
  let pay_cred = Script(policy)

  let Output { value, datum, .. } =
    must_find(
      outputs,
      // (GOS-1) Require an output locked by the script policy.
      fn(output) { output.address.payment_credential == pay_cred },
    )

  // (GOS-2) Ensure the output holds exactly one NFT under the policy.
  expect is_singleton(value, policy, "")

  // (GOS-3) Require the datum to be provided inline.
  expect InlineDatum(datum) = datum

  datum
}

pub fn get_input_state_by_policy(inputs: List<Input>, policy: PolicyId) {
  // (GIS-1) Find an input carrying exactly one NFT under the policy.
  expect InlineDatum(datum) =
    must_find(
      inputs,
      fn(input) { is_singleton(input.output.value, policy, "") },
    ).output.datum

  datum
}

pub fn input_linked_mint(
  inputs: List<Input>,
  mint: Value,
  outputs: List<Output>,
  own_policy: PolicyId,
  one_shot_ref: OutputReference,
) {
  // Spend a determined input so minting can only happen once
  // (ILM-1) Require the transaction to consume the configured one-shot input before minting.
  expect
    list.any(
      inputs,
      fn(input: Input) { input.output_reference == one_shot_ref },
    )

  // (ILM-2) Locate the policy being minted; fail if the policy is missing.
  let Pair(_, tokens) =
    mint
      |> to_dict
      |> to_pairs
      |> must_find(fn(value) { value.1st == own_policy })

  // (ILM-3) Enforce the forever policy to mint exactly one token with the empty asset name.
  expect [Pair("", 1)] = tokens |> to_pairs

  // (ILM-4) Fetch the script output carrying the freshly minted token; fail if layout is incorrect.
  let datum = get_output_state_by_policy(outputs, own_policy)

  datum
}

pub fn is_singleton(value: Value, policy: PolicyId, name: AssetName) -> Bool {
  // (SING-1) Check that the value contains only the specified policy/name pair.
  expect [_, ..nft] = value |> to_dict |> to_pairs
  as_data(nft) == as_data([Pair(policy, [Pair(name, 1)])])
}

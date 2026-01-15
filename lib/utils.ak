use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{AssetName, PolicyId, Value, to_dict}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}

/// Finds a key in a pair list, failing if not found.
pub fn must_find_key(pairs: Pairs<ByteArray, a>, key: ByteArray) -> a {
  expect [item, ..rest] = pairs

  if ( item |> builtin.fst_pair ) == key {
    item |> builtin.snd_pair
  } else {
    must_find_key(rest, key)
  }
}

/// Finds the first element matching the predicate, failing if none found.
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

/// Right fold with two accumulators. Used for parallel accumulation.
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

/// Finds an output locked by the policy, validates it holds a singleton NFT,
/// and returns its inline datum.
pub fn get_output_state_by_policy(outputs: List<Output>, policy: PolicyId) {
  let pay_cred = Script(policy)

  let Output { value, datum, .. } =
    must_find(
      outputs,
      fn(output) { output.address.payment_credential == pay_cred },
    )

  expect is_singleton(value, policy, "")

  expect InlineDatum(datum) = datum

  datum
}

/// Finds an input carrying a singleton NFT under the policy and returns its inline datum.
pub fn get_input_state_by_policy(inputs: List<Input>, policy: PolicyId) {
  expect InlineDatum(datum) =
    must_find(
      inputs,
      fn(input) { is_singleton(input.output.value, policy, "") },
    ).output.datum

  datum
}

/// Validates one-shot minting: requires one-shot input consumption,
/// exactly one token minted, and returns the output datum.
pub fn input_linked_mint(
  inputs: List<Input>,
  mint: Value,
  outputs: List<Output>,
  own_policy: PolicyId,
  one_shot_ref: OutputReference,
) {
  // One-shot input must be consumed
  expect
    list.any(
      inputs,
      fn(input: Input) { input.output_reference == one_shot_ref },
    )

  let Pair(_, tokens) =
    mint
      |> to_dict
      |> to_pairs
      |> must_find(fn(value) { value.1st == own_policy })

  // Must mint exactly one token with empty asset name
  expect [Pair("", 1)] = tokens |> to_pairs

  let datum = get_output_state_by_policy(outputs, own_policy)

  datum
}

/// Checks if value contains only ADA plus a singleton NFT under the given policy/name.
pub fn is_singleton(value: Value, policy: PolicyId, name: AssetName) -> Bool {
  expect [_, ..nft] = value |> to_dict |> to_pairs
  as_data(nft) == as_data([Pair(policy, [Pair(name, 1)])])
}

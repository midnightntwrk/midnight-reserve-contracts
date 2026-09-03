//// Value access without stdlib lookups: one walk over the underlying pairs.

use aiken/collection/dict.{Dict, to_pairs}
use cardano/assets.{AssetName, PolicyId, Value, to_dict}

/// Assets under `policy`, ordered by name; `[]` when absent.
pub fn tokens_of(value: Value, policy: PolicyId) -> Pairs<AssetName, Int> {
  find_policy(value |> to_dict |> to_pairs, policy)
}

fn find_policy(
  pairs: Pairs<PolicyId, Dict<AssetName, Int>>,
  policy: PolicyId,
) -> Pairs<AssetName, Int> {
  when pairs is {
    [] -> []
    [Pair(p, tokens), ..rest] ->
      if p == policy {
        to_pairs(tokens)
      } else {
        find_policy(rest, policy)
      }
  }
}

/// Quantity of `name` in ordered token pairs; 0 when absent.
pub fn quantity(tokens: Pairs<AssetName, Int>, name: AssetName) -> Int {
  when tokens is {
    [] -> 0
    [Pair(n, q), ..rest] ->
      if n == name {
        q
      } else {
        quantity(rest, name)
      }
  }
}

/// Remove the entry `(name, qty)` from ordered token pairs; fails when absent.
pub fn claim(
  tokens: Pairs<AssetName, Int>,
  name: AssetName,
  qty: Int,
) -> Pairs<AssetName, Int> {
  expect [Pair(n, q), ..rest] = tokens
  if n == name {
    expect q == qty
    rest
  } else {
    [Pair(n, q), ..claim(rest, name, qty)]
  }
}

/// Lovelace and the remaining (non-ADA) policies of an output value, as Data for equality.
pub fn split_ada(value: Value) -> (Int, Data) {
  expect [Pair(_, ada_tokens), ..rest] = value |> to_dict |> to_pairs
  expect [Pair(_, ada)] = to_pairs(ada_tokens)
  (ada, as_data(rest))
}

/// The non-ADA part holding exactly one `name` token under `policy`.
pub fn only_nft(policy: PolicyId, name: AssetName) -> Data {
  as_data([Pair(policy, [Pair(name, 1)])])
}

use aiken/builtin
use aiken/collection/dict.{to_pairs}
use cardano/address.{Script}
use cardano/assets.{PolicyId, to_dict}
use cardano/transaction.{InlineDatum, Input, Output}

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
      fn(output) { output.address.payment_credential == pay_cred },
    )

  expect [_, ..nft_id] = value |> to_dict |> to_pairs

  expect as_data(nft_id) == as_data([Pair(policy, [Pair("", 1)])])

  expect InlineDatum(datum) = datum

  datum
}

pub fn get_input_state_by_policy(inputs: List<Input>, policy: PolicyId) {
  expect InlineDatum(datum) =
    must_find(
      inputs,
      fn(input) {
        expect [_, ..assets] = input.output.value |> to_dict |> to_pairs

        as_data(assets) == as_data([Pair(policy, [Pair("", 1)])])
      },
    ).output.datum

  datum
}

use aiken/builtin

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

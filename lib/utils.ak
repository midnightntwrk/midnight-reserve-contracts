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

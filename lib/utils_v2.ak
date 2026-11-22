/// Whether some pair's key is `key`.
pub fn has_key(pairs: Pairs<k, v>, key: k) -> Bool {
  when pairs is {
    [] -> False
    [Pair(item_key, _), ..rest] ->
      if item_key == key {
        True
      } else {
        has_key(rest, key)
      }
  }
}

/// The value of the first pair whose key is `key`.
pub fn find_key(pairs: Pairs<k, v>, key: k) -> Option<v> {
  when pairs is {
    [] -> None
    [Pair(item_key, value), ..rest] ->
      if item_key == key {
        Some(value)
      } else {
        find_key(rest, key)
      }
  }
}

/// Whether `x` is in the list.
pub fn has(self: List<a>, x: a) -> Bool {
  when self is {
    [] -> False
    [item, ..rest] ->
      if item == x {
        True
      } else {
        has(rest, x)
      }
  }
}

/// Right fold with one accumulator.
pub fn foldr(self: List<a>, zero: b, with: fn(a, b) -> b) -> b {
  when self is {
    [] -> zero
    [x, ..xs] -> with(x, foldr(xs, zero, with))
  }
}

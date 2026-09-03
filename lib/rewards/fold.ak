//// Left folds with two accumulators in continuation-passing style: no tuple
//// allocation per element.

pub type Fold2<a, b, result> =
  fn(a, b) -> result

/// `with` receives the element, both accumulators, and the continuation.
pub fn foldl2(
  self: List<elem>,
  acc_a: a,
  acc_b: b,
  with: fn(elem, a, b, Fold2<a, b, result>) -> result,
  return: Fold2<a, b, result>,
) -> result {
  when self is {
    [] -> return(acc_a, acc_b)
    [x, ..xs] -> {
      let a, b <- with(x, acc_a, acc_b)
      foldl2(xs, a, b, with, return)
    }
  }
}

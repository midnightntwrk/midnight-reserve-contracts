//// Test-side builder for the Substrate V1 extrinsics trie (`rewards/trie`):
//// the root, the encoded nodes, and the root-first proof for one index.
//// Not imported by validators.

use aiken/builtin
use aiken/collection/list
use rewards/scale.{compact_encode}

pub type Node {
  Leaf { partial: List<Int>, value: ByteArray }
  Branch { partial: List<Int>, children: List<Option<Node>> }
}

/// Trie of `extrinsics` keyed by `Compact(index)`.
pub fn build(extrinsics: List<ByteArray>) -> Node {
  extrinsics
    |> list.indexed_map(fn(i, xt) { (nibbles(compact_encode(i)), xt) })
    |> list.sort(fn(a, b) { compare_nibbles(a.1st, b.1st) })
    |> build_sorted
}

pub fn root(node: Node) -> ByteArray {
  builtin.blake2b_256(encode(node))
}

/// Hash-referenced nodes on the path to `Compact(index)`, root first.
pub fn proof(node: Node, index: Int) -> List<ByteArray> {
  path(node, nibbles(compact_encode(index)), True)
}

pub fn nibbles(bytes: ByteArray) -> List<Int> {
  list.range(0, builtin.length_of_bytearray(bytes) - 1)
    |> list.flat_map(
        fn(i) {
          let byte = builtin.index_bytearray(bytes, i)
          [byte / 16, byte % 16]
        },
      )
}

fn compare_nibbles(a: List<Int>, b: List<Int>) -> Ordering {
  when (a, b) is {
    ([], []) -> Equal
    ([], _) -> Less
    (_, []) -> Greater
    ([x, ..xs], [y, ..ys]) ->
      if x < y {
        Less
      } else if x > y {
        Greater
      } else {
        compare_nibbles(xs, ys)
      }
  }
}

fn build_sorted(entries: List<(List<Int>, ByteArray)>) -> Node {
  when entries is {
    [(key, value)] -> Leaf { partial: key, value }
    [(first, _), ..] -> {
      let prefix = list.foldl(entries, first, fn(e, acc) { common(acc, e.1st) })
      let stripped =
        list.map(
          entries,
          fn(e) { (list.drop(e.1st, list.length(prefix)), e.2nd) },
        )
      let children =
        list.map(
          list.range(0, 15),
          fn(c) {
            when
              list.filter(stripped, fn(e) { list.head(e.1st) == Some(c) })
            is {
              [] -> None
              group ->
                Some(
                  build_sorted(
                    list.map(group, fn(e) { (list.drop(e.1st, 1), e.2nd) }),
                  ),
                )
            }
          },
        )
      Branch { partial: prefix, children }
    }
    [] -> fail
  }
}

fn common(a: List<Int>, b: List<Int>) -> List<Int> {
  when (a, b) is {
    ([x, ..xs], [y, ..ys]) ->
      if x == y {
        [x, ..common(xs, ys)]
      } else {
        []
      }
    _ -> []
  }
}

pub fn encode(node: Node) -> ByteArray {
  when node is {
    Leaf { partial, value } ->
      if builtin.length_of_bytearray(value) >= 33 {
        header(32, partial)
          |> builtin.append_bytearray(builtin.blake2b_256(value))
      } else {
        header(64, partial)
          |> builtin.append_bytearray(
              compact_encode(builtin.length_of_bytearray(value)),
            )
          |> builtin.append_bytearray(value)
      }
    Branch { partial, children } -> {
      let bitmap =
        list.indexed_foldr(
          children,
          0,
          fn(i, child, acc) {
            when child is {
              Some(_) -> acc + pow2(i)
              None -> acc
            }
          },
        )
      let refs =
        list.foldr(
          children,
          "",
          fn(child, acc) {
            when child is {
              Some(n) -> builtin.append_bytearray(reference(n), acc)
              None -> acc
            }
          },
        )
      header(128, partial)
        |> builtin.append_bytearray(
            builtin.integer_to_bytearray(False, 2, bitmap),
          )
        |> builtin.append_bytearray(refs)
    }
  }
}

fn reference(node: Node) -> ByteArray {
  let bytes = encode(node)
  if builtin.length_of_bytearray(bytes) < 32 {
    compact_encode(builtin.length_of_bytearray(bytes))
      |> builtin.append_bytearray(bytes)
  } else {
    compact_encode(32) |> builtin.append_bytearray(builtin.blake2b_256(bytes))
  }
}

fn header(kind: Int, partial: List<Int>) -> ByteArray {
  let n = list.length(partial)
  let padded =
    if n % 2 == 1 {
      [0, ..partial]
    } else {
      partial
    }
  builtin.integer_to_bytearray(True, 1, kind + n)
    |> builtin.append_bytearray(pack(padded))
}

fn pack(nibbles: List<Int>) -> ByteArray {
  when nibbles is {
    [hi, lo, ..rest] ->
      builtin.integer_to_bytearray(True, 1, hi * 16 + lo)
        |> builtin.append_bytearray(pack(rest))
    _ -> ""
  }
}

fn pow2(e: Int) -> Int {
  if e == 0 {
    1
  } else {
    2 * pow2(e - 1)
  }
}

fn path(node: Node, key: List<Int>, hashed: Bool) -> List<ByteArray> {
  let here =
    if hashed {
      [encode(node)]
    } else {
      []
    }
  when node is {
    Leaf { .. } -> here
    Branch { partial, children } -> {
      let rest = list.drop(key, list.length(partial))
      expect [c, ..rest] = rest
      expect Some(Some(child)) = list.at(children, c)
      let child_hashed = builtin.length_of_bytearray(encode(child)) >= 32
      list.concat(here, path(child, rest, child_hashed))
    }
  }
}

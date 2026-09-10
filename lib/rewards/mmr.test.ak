// Budget (aiken check, 2026-09-10), `leaf_root` on synthetic items, each
// test including ~20 keccaks of item construction:
//   552 of 553       (3 items)   mem 224 K  cpu  87 M
//   12345 of 50000   (16 items)  mem 313 K  cpu 194 M
//   700000 of 1e6    (20 items)  mem 427 K  cpu 253 M
// The positional reference walk below cost 3.37 M / 1.19 B and
// 8.76 M / 2.98 B on the last two; that is why the index walk is the one
// on chain (plans/rewards/03-digest-proof.md).

use aiken/builtin
use aiken/collection/list
use rewards/mmr.{leaf_root, verify_leaf}

// Positional reference, mirroring polkadot-ckb-merkle-mountain-range 0.8.2:
// node positions, `pos_height`, peaks, `gen_proof` and a positional root.

fn merge(left: ByteArray, right: ByteArray) -> ByteArray {
  builtin.append_bytearray(left, right) |> builtin.keccak_256
}

fn pow2(e: Int) -> Int {
  if e == 0 {
    1
  } else {
    2 * pow2(e - 1)
  }
}

fn bit_length(n: Int) -> Int {
  if n == 0 {
    0
  } else {
    1 + bit_length(n / 2)
  }
}

fn popcount(n: Int) -> Int {
  if n == 0 {
    0
  } else {
    n % 2 + popcount(n / 2)
  }
}

fn trailing_zeros(n: Int) -> Int {
  if n % 2 == 1 {
    0
  } else {
    1 + trailing_zeros(n / 2)
  }
}

fn leaf_pos(index: Int) -> Int {
  let n = index + 1
  2 * n - popcount(n) - trailing_zeros(n) - 1
}

/// Strip leading all-ones blocks of `pos + 1`; the remaining bit length - 1.
fn pos_height(pos: Int) -> Int {
  height_of(pos + 1)
}

fn height_of(p: Int) -> Int {
  let bits = bit_length(p)
  let top = pow2(bits - 1)
  if p == 2 * top - 1 {
    bits - 1
  } else {
    height_of(p - ( top - 1 ))
  }
}

fn peaks(leaf_count: Int) -> List<Int> {
  peaks_from(leaf_count, bit_length(leaf_count) - 1, 0)
}

fn peaks_from(remaining: Int, height: Int, offset: Int) -> List<Int> {
  if height < 0 {
    []
  } else {
    let leaves = pow2(height)
    if remaining >= leaves {
      let nodes = 2 * leaves - 1
      [
        offset + nodes - 1,
        ..peaks_from(remaining - leaves, height - 1, offset + nodes)
      ]
    } else {
      peaks_from(remaining, height - 1, offset)
    }
  }
}

fn bag(rightmost_first: List<ByteArray>) -> ByteArray {
  expect [right, ..lefts] = rightmost_first
  list.foldl(lefts, right, fn(left, acc) { merge(acc, left) })
}

/// Positional root: the ckb `calculate_peaks_hashes` walk for one leaf.
fn ref_root(
  leaf_hash: ByteArray,
  leaf_index: Int,
  leaf_count: Int,
  items: List<ByteArray>,
) -> ByteArray {
  walk(peaks(leaf_count), leaf_pos(leaf_index), leaf_hash, items, []) |> bag
}

fn walk(
  peaks: List<Int>,
  pos: Int,
  hash: ByteArray,
  items: List<ByteArray>,
  acc: List<ByteArray>,
) -> List<ByteArray> {
  expect [peak, ..rest] = peaks
  if pos > peak {
    expect [left_peak, ..items] = items
    walk(rest, pos, hash, items, [left_peak, ..acc])
  } else {
    let (peak_hash, items) = climb(hash, pos, 0, peak, items)
    when rest is {
      [] -> {
        expect [] = items
        [peak_hash, ..acc]
      }
      _ -> {
        expect [rhs] = items
        [rhs, peak_hash, ..acc]
      }
    }
  }
}

fn climb(
  hash: ByteArray,
  pos: Int,
  height: Int,
  peak: Int,
  items: List<ByteArray>,
) -> (ByteArray, List<ByteArray>) {
  if pos == peak {
    (hash, items)
  } else {
    expect [sibling, ..items] = items
    if pos_height(pos + 1) > height {
      climb(merge(sibling, hash), pos + 1, height + 1, peak, items)
    } else {
      climb(
        merge(hash, sibling),
        pos + pow2(height + 1),
        height + 1,
        peak,
        items,
      )
    }
  }
}

// Builder: nodes in append order, proof per ckb `gen_proof` for one leaf.

fn at(nodes: List<ByteArray>, pos: Int) -> ByteArray {
  expect Some(node) = list.at(nodes, pos)
  node
}

fn push(nodes: List<ByteArray>, leaf: ByteArray) -> List<ByteArray> {
  let pos = list.length(nodes)
  grow(list.concat(nodes, [leaf]), pos, 0)
}

fn grow(nodes: List<ByteArray>, pos: Int, height: Int) -> List<ByteArray> {
  if pos_height(pos + 1) > height {
    let pos = pos + 1
    let left = pos - pow2(height + 1)
    let right = left + pow2(height + 1) - 1
    grow(
      list.concat(nodes, [merge(at(nodes, left), at(nodes, right))]),
      pos,
      height + 1,
    )
  } else {
    nodes
  }
}

fn build(leaves: List<ByteArray>) -> List<ByteArray> {
  list.foldl(leaves, [], fn(leaf, nodes) { push(nodes, leaf) })
}

fn root(nodes: List<ByteArray>, leaf_count: Int) -> ByteArray {
  peaks(leaf_count) |> list.map(at(nodes, _)) |> list.reverse |> bag
}

fn gen_proof(
  nodes: List<ByteArray>,
  leaf_count: Int,
  index: Int,
) -> List<ByteArray> {
  let pos = leaf_pos(index)
  let (left_peaks, rest) =
    list.partition(peaks(leaf_count), fn(peak) { peak < pos })
  expect [peak, ..right_peaks] = rest
  let lefts = list.map(left_peaks, at(nodes, _))
  let siblings = climb_siblings(nodes, pos, 0, peak)
  let rhs =
    when right_peaks is {
      [] -> []
      [only] -> [at(nodes, only)]
      _ -> [list.map(right_peaks, at(nodes, _)) |> list.reverse |> bag]
    }
  list.concat(lefts, list.concat(siblings, rhs))
}

fn climb_siblings(
  nodes: List<ByteArray>,
  pos: Int,
  height: Int,
  peak: Int,
) -> List<ByteArray> {
  if pos == peak {
    []
  } else {
    let offset = pow2(height + 1) - 1
    let (sibling, parent) =
      if pos_height(pos + 1) > height {
        (pos - offset, pos + 1)
      } else {
        (pos + offset, pos + offset + 1)
      }
    [at(nodes, sibling), ..climb_siblings(nodes, parent, height + 1, peak)]
  }
}

fn leaf(i: Int) -> ByteArray {
  builtin.keccak_256(builtin.integer_to_bytearray(True, 4, i))
}

fn leaves(n: Int) -> List<ByteArray> {
  list.map(list.range(0, n - 1), leaf)
}

// Reference helpers.

test pos_height_values() {
  and {
    pos_height(0) == 0,
    pos_height(1) == 0,
    pos_height(2) == 1,
    pos_height(3) == 0,
    pos_height(6) == 2,
    pos_height(9) == 1,
    pos_height(14) == 3,
  }
}

test leaf_pos_values() {
  list.map(list.range(0, 8), leaf_pos) == [0, 1, 3, 4, 7, 8, 10, 11, 15]
}

test peaks_values() {
  and {
    peaks(1) == [0],
    peaks(2) == [2],
    peaks(3) == [2, 3],
    peaks(4) == [6],
    peaks(7) == [6, 9, 10],
    peaks(8) == [14],
    peaks(11) == [14, 17, 18],
  }
}

// `leaf_root` against the builder root and the positional reference for
// every leaf of every size 1..24.

test every_leaf_of_sizes_1_to_24() {
  list.all(
    list.range(1, 24),
    fn(n) {
      let nodes = build(leaves(n))
      let expected = root(nodes, n)
      list.all(
        list.range(0, n - 1),
        fn(i) {
          let items = gen_proof(nodes, n, i)
          and {
            leaf_root(leaf(i), i, n, items) == expected,
            ref_root(leaf(i), i, n, items) == expected,
            verify_leaf(expected, leaf(i), i, n, items),
          }
        },
      )
    },
  )
}

test single_leaf_mmr() {
  leaf_root(leaf(0), 0, 1, []) == leaf(0)
}

// Golden vectors from lib/bridge/merkle.ak: the latest leaf of an odd MMR
// is a lone peak, so the items are the left peaks only and the bridge's
// foldr is the same computation.

test golden_553() {
  let leaf_hash =
    #"0000000000000000000000000000000000000000000000000000000000000000"
  let items =
    [
      #"48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
      #"9535761693a1e47e66817cdf25371c1d64ef318ee8c85ce67d3d88b12aaa1b83",
      #"6403a4149a189e4f9ab21045adee353c5ba4d878600f8d23e6eaba76d0ac6269",
    ]
  let bridge = list.foldr(items, leaf_hash, fn(peak, acc) { merge(acc, peak) })
  leaf_root(leaf_hash, 552, 553, items) == bridge
}

test golden_601() {
  let leaf_hash =
    #"1111111111111111111111111111111111111111111111111111111111111111"
  let items =
    [
      #"48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
      #"1f86e403238b1ce4aa6cd5c665e09821eb5a77acc6558c3e5d0192ec66bc1dee",
      #"d8f44f672c85e903549242cfcfd619432e692386a684d99fce21ca863bc10869",
      #"54d7061256cecc20b599f9a3331b9298b607a7f95cf3ee40cd1a50ab66792ae3",
    ]
  let bridge = list.foldr(items, leaf_hash, fn(peak, acc) { merge(acc, peak) })
  leaf_root(leaf_hash, 600, 601, items) == bridge
}

// Negatives.

/// Leaf 5 has the same item shape as leaf 4 (one left peak, one sibling).
test wrong_leaf_index_fails() {
  let n = 6
  let nodes = build(leaves(n))
  !verify_leaf(root(nodes, n), leaf(4), 5, n, gen_proof(nodes, n, 4))
}

/// Leaf 3 needs two siblings and a bagged rhs: the item shape mismatches.
test wrong_leaf_index_shape_rejected() fail {
  let n = 6
  let nodes = build(leaves(n))
  verify_leaf(root(nodes, n), leaf(4), 3, n, gen_proof(nodes, n, 4))
}

test wrong_leaf_hash_fails() {
  let n = 6
  let nodes = build(leaves(n))
  !verify_leaf(root(nodes, n), leaf(3), 4, n, gen_proof(nodes, n, 4))
}

test extra_item_rejected() fail {
  let n = 6
  let nodes = build(leaves(n))
  let items = list.concat(gen_proof(nodes, n, 4), [leaf(9)])
  verify_leaf(root(nodes, n), leaf(4), 4, n, items)
}

test missing_item_rejected() fail {
  let n = 6
  let nodes = build(leaves(n))
  expect [_, ..items] = gen_proof(nodes, n, 4)
  verify_leaf(root(nodes, n), leaf(4), 4, n, items)
}

test index_out_of_range_rejected() fail {
  verify_leaf(leaf(0), leaf(0), 6, 6, [])
}

test negative_index_rejected() fail {
  verify_leaf(leaf(0), leaf(0), -1, 6, [])
}

// Large trees on synthetic items: agreement with the reference, and budget.
// Item count = left peaks + climb height + one bagged rhs when any.

fn synthetic_items(n: Int) -> List<ByteArray> {
  list.map(list.range(1, n), leaf)
}

test agrees_with_reference_on_large_trees() {
  list.all(
    [
      (0, 50000, 16), (12345, 50000, 16), (49999, 50000, 9), (1000, 65536, 16),
      (700000, 1000000, 20), (3, 5000000, 23),
    ],
    fn(case) {
      let (i, n, k) = case
      let items = synthetic_items(k)
      leaf_root(leaf(0), i, n, items) == ref_root(leaf(0), i, n, items)
    },
  )
}

test budget_552_of_553() {
  builtin.length_of_bytearray(leaf_root(leaf(0), 552, 553, synthetic_items(3))) == 32
}

test budget_12345_of_50000() {
  builtin.length_of_bytearray(
    leaf_root(leaf(0), 12345, 50000, synthetic_items(16)),
  ) == 32
}

test budget_700000_of_1000000() {
  builtin.length_of_bytearray(
    leaf_root(leaf(0), 700000, 1000000, synthetic_items(20)),
  ) == 32
}

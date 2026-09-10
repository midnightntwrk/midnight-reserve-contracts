//// Single-leaf MMR inclusion proof (spec §7.1) matching
//// `polkadot-ckb-merkle-mountain-range` 0.8.2 as pallet-mmr uses it:
//// keccak-256, `H(left || right)` when climbing, peaks bagged right-to-left
//// as `H(right || left)`. Proof items, in order: one hash per peak left of
//// the leaf's peak, the climb siblings bottom-up, then one item for
//// everything right of the leaf's peak (already bagged by the prover) when
//// any right peak exists.
////
//// The walk is by leaf index, not node position: the binary digits of
//// `leaf_count` give the peaks by descending height, and the bits of the
//// leaf's offset inside its peak give left/right at each level. The
//// positional reference walk lives in `mmr.test.ak` as the oracle.

use aiken/builtin
use aiken/collection/list

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

pub fn verify_leaf(
  root: ByteArray,
  leaf_hash: ByteArray,
  leaf_index: Int,
  leaf_count: Int,
  items: List<ByteArray>,
) -> Bool {
  root == leaf_root(leaf_hash, leaf_index, leaf_count, items)
}

/// Root implied by `items` for `leaf_hash` at `leaf_index` of `leaf_count`.
/// Every item must be consumed.
pub fn leaf_root(
  leaf_hash: ByteArray,
  leaf_index: Int,
  leaf_count: Int,
  items: List<ByteArray>,
) -> ByteArray {
  expect leaf_index >= 0 && leaf_index < leaf_count
  walk_peaks(
    leaf_count,
    bit_length(leaf_count) - 1,
    leaf_index,
    leaf_hash,
    items,
    [],
  )
    |> bag
}

/// Peaks by descending height; `index` is relative to the current block.
/// Returns peak hashes rightmost-first.
fn walk_peaks(
  remaining: Int,
  height: Int,
  index: Int,
  hash: ByteArray,
  items: List<ByteArray>,
  acc: List<ByteArray>,
) -> List<ByteArray> {
  let leaves = pow2(height)
  if remaining < leaves {
    walk_peaks(remaining, height - 1, index, hash, items, acc)
  } else if index >= leaves {
    expect [left_peak, ..items] = items
    walk_peaks(
      remaining - leaves,
      height - 1,
      index - leaves,
      hash,
      items,
      [left_peak, ..acc],
    )
  } else {
    let peak_hash, items <- climb(hash, index, height, items)
    if remaining == leaves {
      expect [] = items
      [peak_hash, ..acc]
    } else {
      expect [rhs] = items
      [rhs, peak_hash, ..acc]
    }
  }
}

/// Bit `i` of `offset` set means the node at level `i` is a right child.
fn climb(
  hash: ByteArray,
  offset: Int,
  levels: Int,
  items: List<ByteArray>,
  callback: fn(ByteArray, List<ByteArray>) -> r,
) -> r {
  if levels == 0 {
    callback(hash, items)
  } else {
    expect [sibling, ..items] = items
    let hash =
      if offset % 2 == 1 {
        merge(sibling, hash)
      } else {
        merge(hash, sibling)
      }
    climb(hash, offset / 2, levels - 1, items, callback)
  }
}

/// `acc = H(acc || next_left)` from the rightmost peak.
fn bag(rightmost_first: List<ByteArray>) -> ByteArray {
  expect [right, ..lefts] = rightmost_first
  list.foldl(lefts, right, fn(left, acc) { merge(acc, left) })
}

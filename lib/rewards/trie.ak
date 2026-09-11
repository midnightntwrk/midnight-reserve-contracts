//// Inclusion proof for a Substrate `extrinsics_root`: a base-16 radix trie
//// (`sp_trie::LayoutV1`, blake2b-256, no extension nodes) keyed by the
//// SCALE compact index of each extrinsic. Node layout (spec §7.1):
////
//// ```
//// header byte  01nnnnnn leaf, value inline      001nnnnn leaf, value hashed
////              10nnnnnn branch without value    (11…, 0001… never occur: keys are prefix-free)
//// partial      ceil(n / 2) bytes; odd n puts the first nibble in the low half of byte 0
//// leaf         value = Compact(len) || bytes, or the 32-byte blake2b-256 of a value ≥ 33 bytes
//// branch       bitmap u16 LE (bit i = child i present), then each present child as
////              Compact(len) || bytes: len 32 is a hash reference, shorter is the child inline
//// ```
////
//// `nodes` lists the hash-referenced nodes root first; inline children are
//// embedded in their parent. `n < 63` (`< 31` hashed) is required: extrinsic
//// keys are at most 4 bytes.

use aiken/builtin
use aiken/math
use rewards/scale.{compact, le}

const leaf_inline = 0

const leaf_hashed = 1

const branch = 2

/// `value` is stored under `key` in the trie whose root hash is `root`.
pub fn verify(
  root: ByteArray,
  key: ByteArray,
  nodes: List<ByteArray>,
  value: ByteArray,
) -> Bool {
  walk_hashed(root, 0, key, 2 * builtin.length_of_bytearray(key), nodes, value)
}

fn walk_hashed(
  expected: ByteArray,
  i: Int,
  key: ByteArray,
  total: Int,
  nodes: List<ByteArray>,
  value: ByteArray,
) -> Bool {
  expect [node, ..rest] = nodes
  expect builtin.blake2b_256(node) == expected
  walk(node, i, key, total, rest, value)
}

/// `i` is the number of key nibbles already consumed.
fn walk(
  node: ByteArray,
  i: Int,
  key: ByteArray,
  total: Int,
  nodes: List<ByteArray>,
  value: ByteArray,
) -> Bool {
  let kind, n <- header(builtin.index_bytearray(node, 0))
  expect partial_matches(node, n, key, i, 0)
  let i = i + n
  let at = 1 + ( n + 1 ) / 2
  if kind == branch {
    expect i < total
    let child = nibble(key, i)
    let bitmap = le(node, at, 2)
    expect bit(bitmap, child)
    let at = skip_children(node, at + 2, bitmap, 0, child)
    let len, at <- compact(node, at)
    let bytes = builtin.slice_bytearray(at, len, node)
    if len == 32 {
      walk_hashed(bytes, i + 1, key, total, nodes, value)
    } else {
      walk(bytes, i + 1, key, total, nodes, value)
    }
  } else {
    expect i == total && nodes == []
    if kind == leaf_hashed {
      builtin.slice_bytearray(at, 32, node) == builtin.blake2b_256(value)
    } else {
      let len, at <- compact(node, at)
      builtin.slice_bytearray(at, len, node) == value
    }
  }
}

fn header(first: Int, return: fn(Int, Int) -> result) -> result {
  if first >= 192 {
    fail
  } else if first >= 128 {
    expect first < 191
    return(branch, first - 128)
  } else if first >= 64 {
    expect first < 127
    return(leaf_inline, first - 64)
  } else {
    expect first >= 32 && first < 63
    return(leaf_hashed, first - 32)
  }
}

/// Nibble `j` of the partial key equals key nibble `i + j`, for every `j < n`.
fn partial_matches(
  node: ByteArray,
  n: Int,
  key: ByteArray,
  i: Int,
  j: Int,
) -> Bool {
  if j == n {
    True
  } else {
    let idx = j + n % 2
    let byte = builtin.index_bytearray(node, 1 + idx / 2)
    let got =
      if idx % 2 == 0 {
        byte / 16
      } else {
        byte % 16
      }
    got == nibble(key, i + j) && partial_matches(node, n, key, i, j + 1)
  }
}

fn nibble(key: ByteArray, i: Int) -> Int {
  let byte = builtin.index_bytearray(key, i / 2)
  if i % 2 == 0 {
    byte / 16
  } else {
    byte % 16
  }
}

fn bit(bitmap: Int, i: Int) -> Bool {
  bitmap / math.pow2(i) % 2 == 1
}

/// Offset of child `target`, skipping the present children before it.
fn skip_children(
  node: ByteArray,
  at: Int,
  bitmap: Int,
  child: Int,
  target: Int,
) -> Int {
  if child == target {
    at
  } else if bit(bitmap, child) {
    let len, next <- compact(node, at)
    skip_children(node, next + len, bitmap, child + 1, target)
  } else {
    skip_children(node, at, bitmap, child + 1, target)
  }
}

//// Merkle verification for the bridge: the authority-set multiproof (five
//// node shapes, leaves returned in tree order) and the single-leaf MMR
//// inclusion proof matching `polkadot-ckb-merkle-mountain-range` 0.8.2 as
//// pallet-mmr uses it: keccak-256, `H(left || right)` when climbing, peaks
//// bagged right-to-left as `H(right || left)`. Proof items, in order: one
//// hash per peak left of the leaf's peak, the climb siblings bottom-up, then
//// one item for everything right of the leaf's peak when any right peak
//// exists. The walk is by leaf index: the binary digits of `leaf_count` give
//// the peaks by descending height, and the bits of the leaf's offset inside
//// its peak give left/right at each level.

use aiken/builtin
use aiken/collection/list
use bridge/types.{Leaf, ProofNodeRec}

fn merge_nodes(a: ByteArray, b: ByteArray) -> ByteArray {
  builtin.append_bytearray(a, b) |> builtin.keccak_256
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

/// Check `items` prove `leaf_hash` at `leaf_index` of an MMR with `leaf_count` leaves and root `root`.
pub fn verify_mmr_leaf(
  root: ByteArray,
  leaf_hash: ByteArray,
  leaf_index: Int,
  leaf_count: Int,
  items: List<ByteArray>,
) -> Bool {
  root == leaf_root(leaf_hash, leaf_index, leaf_count, items)
}

/// Root implied by `items` for `leaf_hash` at `leaf_index` of `leaf_count`; every item must be consumed.
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

/// Peaks by descending height; `index` is relative to the current block. Returns peak hashes rightmost-first.
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
        merge_nodes(sibling, hash)
      } else {
        merge_nodes(hash, sibling)
      }
    climb(hash, offset / 2, levels - 1, items, callback)
  }
}

/// `acc = H(acc || next_left)` from the rightmost peak.
fn bag(rightmost_first: List<ByteArray>) -> ByteArray {
  expect [right, ..lefts] = rightmost_first
  list.foldl(lefts, right, fn(left, acc) { merge_nodes(acc, left) })
}

/// Walk a multiproof, check its root, and return its leaves in tree order.
pub fn verify_multiproof(root: ByteArray, proof: Data) -> List<Leaf> {
  let
    calculated_hash,
    leaves,
  <- do_verify_merkle_multi_proof_get_leaves(proof |> builtin.un_list_data, [])

  expect calculated_hash == root

  leaves
}

/// See merkle_multi_member.md for the expected
/// shape of the tree and proof
/// while this function looks complicated
/// it only has 5 max cases to handle
/// [single_item] -> must be a leaf so we add it to leaves_found and return the leaf_hash
/// untouched
///
/// [list1, list2] -> recurse list2 then list1 and merge(list1, list2) and return the combined leaves_found from each
///
/// [bytearray, list] -> recurse list and merge(bytearray, list) and return leaves_found in list
///
/// [list, bytearray] -> same as above, but merge(list, bytearray)
///
/// [bytearray1, bytearray2] -> we have found the only other case where we can have a leaf
///                             so merge(bytearray1, bytearray2) and [bytearray1, bytearray2, ..leaves_found]
/// The simplicity is that there is no intermediary list required to hold branch_hashes, leaves can only be found in 2 cases
/// a simple depth first search algorithm is used to get the root hash along with the list of all leaves in the proof
fn do_verify_merkle_multi_proof_get_leaves(
  proof: ProofNodeRec,
  leaves_found: List<Leaf>,
  callback,
) {
  when proof is {
    [leaf] -> {
      // case for odd numbered tree items
      let leaf = leaf |> builtin.un_b_data

      callback(leaf |> builtin.keccak_256, [leaf, ..leaves_found])
    }
    [branch1, branch2] ->
      builtin.choose_data(
        branch1,
        fail,
        fail,
        // branch 1 is a list item
        builtin.choose_data(
          branch2,
          fail,
          fail,
          {
            // branch 1  and branch 2 contain unmerged branches below so recurse both
            // merge the result of recursing branch 1 with recursing branch 2
            // recurse branch2 first
            let
              recurse_hash2,
              leaves_found,
            <-
              do_verify_merkle_multi_proof_get_leaves(
                branch2 |> builtin.un_list_data,
                leaves_found,
              )

            let
              recurse_hash1,
              leaves_found,
            <-
              do_verify_merkle_multi_proof_get_leaves(
                branch1 |> builtin.un_list_data,
                leaves_found,
              )

            callback(merge_nodes(recurse_hash1, recurse_hash2), leaves_found)
          },
          fail,
          {
            // branch 2 is a bytearray of already merged leaves aka branch
            // branch 1 contains unmerged branches below so recurse
            // merge the result of recursing branch 1 with branch 2
            let branch2 = branch2 |> builtin.un_b_data

            let
              recurse_hash1,
              leaves_found,
            <-
              do_verify_merkle_multi_proof_get_leaves(
                branch1 |> builtin.un_list_data,
                leaves_found,
              )

            callback(merge_nodes(recurse_hash1, branch2), leaves_found)
          },
        ),
        fail,
        // branch 1 is a bytearray
        builtin.choose_data(
          branch2,
          fail,
          fail,
          {
            // branch 1 is a bytearray of already merged leaves aka branch
            // branch 2 contains unmerged branches below so recurse
            // merge the result of recursing branch2 with branch 1
            let branch1 = branch1 |> builtin.un_b_data

            let
              recurse_hash2,
              leaves_found,
            <-
              do_verify_merkle_multi_proof_get_leaves(
                branch2 |> builtin.un_list_data,
                leaves_found,
              )

            callback(merge_nodes(branch1, recurse_hash2), leaves_found)
          },
          fail,
          {
            // branch 1 and 2 are leaves
            // so in this case we have reached 2 terminal leaves to merge
            let leaf1 = branch1 |> builtin.un_b_data
            let leaf2 = branch2 |> builtin.un_b_data

            callback(
              merge_nodes(
                leaf1 |> builtin.keccak_256,
                leaf2 |> builtin.keccak_256,
              ),
              [leaf1, leaf2, ..leaves_found],
            )
          },
        ),
      )

    _ -> fail
  }
}

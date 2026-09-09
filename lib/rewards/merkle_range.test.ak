// Budget (aiken check, 2026-09-09, for phase 04 sizing), 32 revealed
// leaves at depth 16:
//   budget_32_leaves_depth_16   mem 3.18 M  cpu 1.64 B  (build + verify)
//   budget_baseline_build_only  mem 2.44 M  cpu 1.23 B  (build only)
//   verify_range alone          mem 0.74 M  cpu 0.41 B
// Tx limits are 14 M mem / 10 B cpu, so one 32-leaf range costs about 5%
// of either.

use aiken/builtin
use aiken/collection/list
use bridge/types.{ProofNodeRec}
use rewards/merkle_range.{RewardLeaf, parse_leaf, verify_range}
use rewards/merkle_range_builder.{build_proof, build_proof_indices, build_root}

const sizes = [1, 2, 3, 4, 5, 7, 8, 9, 16, 17]

/// Leaf `i`: ack 0, key = big-endian `i` in 28 bytes, amount = 1000 * i.
fn leaf(i: Int) -> ByteArray {
  #"00"
    |> builtin.append_bytearray(builtin.integer_to_bytearray(True, 28, i))
    |> builtin.append_bytearray(
        builtin.integer_to_bytearray(True, 16, 1000 * i),
      )
}

fn leaves(n: Int) -> List<ByteArray> {
  list.map(list.range(1, n), leaf)
}

/// Verify one contiguous range and compare with the expected slice.
fn range_ok(ls: List<ByteArray>, root: ByteArray, from: Int, to: Int) -> Bool {
  verify_range(root, build_proof(ls, from, to)) == list.slice(ls, from, to)
}

fn all_ranges_ok(n: Int) -> Bool {
  let ls = leaves(n)
  let root = build_root(ls)
  list.all(
    list.range(0, n - 1),
    fn(from) {
      list.all(list.range(from, n - 1), fn(to) { range_ok(ls, root, from, to) })
    },
  )
}

/// Reveal `from..to` inclusive except `hole`.
fn gap(n: Int, from: Int, to: Int, hole: Int) -> List<ByteArray> {
  let ls = leaves(n)
  let indices = list.filter(list.range(from, to), fn(i) { i != hole })
  verify_range(build_root(ls), build_proof_indices(ls, indices))
}

test every_contiguous_range_verifies() {
  list.all(sizes, all_ranges_ok)
}

test contiguous_index_set_matches_range_proof() {
  list.all(
    sizes,
    fn(n) {
      let ls = leaves(n)
      list.all(
        list.range(0, n - 1),
        fn(from) {
          build_proof_indices(ls, list.range(from, n - 1)) == build_proof(
            ls,
            from,
            n - 1,
          )
        },
      )
    },
  )
}

test single_leaf_tree() {
  let ls = leaves(1)
  verify_range(build_root(ls), build_proof(ls, 0, 0)) == ls
}

test parse_leaf_fields() {
  parse_leaf(leaf(7)) == RewardLeaf {
    ack: 0,
    key: builtin.integer_to_bytearray(True, 28, 7),
    amount: 7000,
  }
}

test parse_leaf_u128_amount() {
  let amount = 340282366920938463463374607431768211455
  let l =
    #"01"
      |> builtin.append_bytearray(builtin.integer_to_bytearray(True, 28, 3))
      |> builtin.append_bytearray(
          builtin.integer_to_bytearray(True, 16, amount),
        )
  parse_leaf(l) == RewardLeaf {
    ack: 1,
    key: builtin.integer_to_bytearray(True, 28, 3),
    amount,
  }
}

// Non-contiguous reveals: a hole of one inside the range.

test gap_3_0_2_1() fail {
  gap(3, 0, 2, 1) != []
}

test gap_4_0_3_1() fail {
  gap(4, 0, 3, 1) != []
}

test gap_4_0_3_2() fail {
  gap(4, 0, 3, 2) != []
}

test gap_5_0_4_2() fail {
  gap(5, 0, 4, 2) != []
}

test gap_5_1_3_2() fail {
  gap(5, 1, 3, 2) != []
}

test gap_5_2_4_3() fail {
  gap(5, 2, 4, 3) != []
}

test gap_7_0_6_3() fail {
  gap(7, 0, 6, 3) != []
}

test gap_7_4_6_5() fail {
  gap(7, 4, 6, 5) != []
}

test gap_8_0_7_4() fail {
  gap(8, 0, 7, 4) != []
}

test gap_8_2_5_3() fail {
  gap(8, 2, 5, 3) != []
}

test gap_9_0_8_7() fail {
  gap(9, 0, 8, 7) != []
}

test gap_9_6_8_7() fail {
  gap(9, 6, 8, 7) != []
}

test gap_16_0_15_8() fail {
  gap(16, 0, 15, 8) != []
}

test gap_16_3_12_7() fail {
  gap(16, 3, 12, 7) != []
}

test gap_17_0_16_15() fail {
  gap(17, 0, 16, 15) != []
}

test gap_17_14_16_15() fail {
  gap(17, 14, 16, 15) != []
}

test two_blocks_far_apart_fail() fail {
  let ls = leaves(17)
  verify_range(build_root(ls), build_proof_indices(ls, [0, 1, 16])) != []
}

test two_blocks_adjacent_subtrees_fail() fail {
  let ls = leaves(8)
  verify_range(build_root(ls), build_proof_indices(ls, [1, 5])) != []
}

// Root and structure.

test wrong_root_fails() fail {
  let ls = leaves(8)
  let root = build_root(leaves(9))
  verify_range(root, build_proof(ls, 2, 5)) != []
}

test swapped_siblings_fail() fail {
  let ls = leaves(4)
  expect [a, b] = build_proof(ls, 0, 1)
  verify_range(build_root(ls), [b, a]) != []
}

test swapped_leaves_fail() fail {
  let ls = leaves(2)
  verify_range(build_root(ls), build_proof(list.reverse(ls), 0, 1)) != []
}

test unsorted_tree_rejected() fail {
  let ls = [leaf(3), leaf(1), leaf(2), leaf(4)]
  verify_range(build_root(ls), build_proof(ls, 0, 3)) != []
}

test duplicate_key_rejected() fail {
  let ls = [leaf(1), leaf(2), leaf(2), leaf(4)]
  verify_range(build_root(ls), build_proof(ls, 1, 2)) != []
}

test short_leaf_rejected() fail {
  let ls = [leaf(1), #"00ff"]
  verify_range(build_root(ls), build_proof(ls, 0, 1)) != []
}

test leaf_presented_as_hash_rejected() fail {
  // `[leaf, [leaf]]` makes the verifier treat the first item as a hash.
  let ls = leaves(2)
  expect [a, b] = build_proof(ls, 0, 1)
  let proof: ProofNodeRec = [a, builtin.list_data([b])]
  verify_range(build_root(ls), proof) != []
}

test hash_presented_as_leaf_rejected() fail {
  // A 32-byte item where a leaf is expected fails the length check even
  // though it would otherwise be hashed.
  let ls = leaves(3)
  let h = builtin.keccak_256(leaf(3))
  let proof: ProofNodeRec =
    [
      builtin.list_data(build_proof(ls, 0, 1)),
      builtin.list_data([builtin.b_data(h)]),
    ]
  verify_range(build_root(ls), proof) != []
}

test empty_proof_rejected() fail {
  verify_range(build_root(leaves(1)), []) != []
}

// Budget probe: 32 revealed leaves at depth 16, i.e. the shape phase 04
// pays for a full batch in a ~50k-leaf tree. Sibling hashes above the
// revealed subtree alternate sides.

fn wrap(
  proof: ProofNodeRec,
  root: ByteArray,
  level: Int,
) -> (ProofNodeRec, ByteArray) {
  if level == 0 {
    (proof, root)
  } else {
    let sibling =
      builtin.keccak_256(builtin.integer_to_bytearray(True, 4, level))
    let (proof, root) =
      if level % 2 == 0 {
        (
          [builtin.b_data(sibling), builtin.list_data(proof)],
          builtin.append_bytearray(sibling, root) |> builtin.keccak_256,
        )
      } else {
        (
          [builtin.list_data(proof), builtin.b_data(sibling)],
          builtin.append_bytearray(root, sibling) |> builtin.keccak_256,
        )
      }
    wrap(proof, root, level - 1)
  }
}

/// Construction only; subtract from `budget_32_leaves_depth_16` for the
/// verifier's own cost.
test budget_baseline_build_only() {
  let ls = leaves(32)
  let (proof, root) = wrap(build_proof(ls, 0, 31), build_root(ls), 11)
  list.length(proof) == 2 && builtin.length_of_bytearray(root) == 32
}

test budget_32_leaves_depth_16() {
  let ls = leaves(32)
  let (proof, root) = wrap(build_proof(ls, 0, 31), build_root(ls), 11)
  verify_range(root, proof) == ls
}

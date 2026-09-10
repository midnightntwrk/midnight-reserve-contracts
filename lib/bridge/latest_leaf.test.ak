use aiken/builtin
use aiken/collection/list
use bridge/beefy.{verify_latest_leaf}
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/types.{AuthoritySetCommitment, BeefyMmrLeaf}

fn merge(left: ByteArray, right: ByteArray) -> ByteArray {
  builtin.append_bytearray(left, right) |> builtin.keccak_256
}

fn leaf(parent_number: Int, parent_hash: ByteArray) -> BeefyMmrLeaf {
  BeefyMmrLeaf {
    version: 0,
    parent_number,
    parent_hash,
    next_authority_set: AuthoritySetCommitment(
      1,
      1,
      #"ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
    ),
    extra: "",
  }
}

fn as_data(items: List<ByteArray>) -> Data {
  builtin.list_data(list.map(items, builtin.b_data))
}

// Golden vectors from lib/bridge/merkle.ak (odd leaf counts).

const leaf_552 =
  leaf(552, #"c40e4fe32fa489a14783829c1e6eb264aec75b012ff58ad82b165386e24a3279")

const items_553 =
  [
    #"48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
    #"9535761693a1e47e66817cdf25371c1d64ef318ee8c85ce67d3d88b12aaa1b83",
    #"6403a4149a189e4f9ab21045adee353c5ba4d878600f8d23e6eaba76d0ac6269",
  ]

const root_553 =
  #"184d38dc3f285e2fda58e07212aec48e479f5d33a491ff805231954bfc5b2af3"

test golden_553() {
  verify_latest_leaf(leaf_552, 553, as_data(items_553), root_553)
}

test golden_601() {
  let l =
    leaf(
      600,
      #"9b9462bf599ab609ea9917918e6b69b54b2bff8b7be6fc0de8984b55f5fbb057",
    )
  let items =
    [
      #"48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
      #"1f86e403238b1ce4aa6cd5c665e09821eb5a77acc6558c3e5d0192ec66bc1dee",
      #"d8f44f672c85e903549242cfcfd619432e692386a684d99fce21ca863bc10869",
      #"54d7061256cecc20b599f9a3331b9298b607a7f95cf3ee40cd1a50ab66792ae3",
    ]
  verify_latest_leaf(
    l,
    601,
    as_data(items),
    #"023bf85dd76a4d6b9d5a5020c083a2a82719c049d4091325e735c5d0fe625c0e",
  )
}

test block_number_must_be_parent_plus_one() fail {
  verify_latest_leaf(leaf_552, 554, as_data(items_553), root_553)
}

test wrong_root_fails() {
  !verify_latest_leaf(leaf_552, 553, as_data(items_553), builtin.keccak_256(""))
}

test extra_item_rejected() fail {
  verify_latest_leaf(
    leaf_552,
    553,
    as_data(list.concat(items_553, [root_553])),
    root_553,
  )
}

// Even leaf count: six leaves, the latest (index 5, position 8) is the
// right child under peak 9. Items: left peak 6, then sibling leaf 4.

fn even_case() -> (BeefyMmrLeaf, List<ByteArray>, ByteArray) {
  let other =
    fn(i: Int) { builtin.keccak_256(builtin.integer_to_bytearray(True, 1, i)) }
  let l5 = leaf(5, other(9))
  let l5_hash = scale_encode_beefy_mmr_leaf(l5) |> builtin.keccak_256
  let node6 = merge(merge(other(0), other(1)), merge(other(2), other(3)))
  let node9 = merge(other(4), l5_hash)
  (l5, [node6, other(4)], merge(node9, node6))
}

test even_count_latest_leaf_verifies() {
  let (l5, items, root) = even_case()
  verify_latest_leaf(l5, 6, as_data(items), root)
}

/// The previous fold, `H(acc || item)` from the last item, hashes the
/// climb step in the wrong order and misses the root.
test old_fold_misses_even_count_root() {
  let (l5, items, root) = even_case()
  let l5_hash = scale_encode_beefy_mmr_leaf(l5) |> builtin.keccak_256
  list.foldr(items, l5_hash, fn(item, acc) { merge(acc, item) }) != root
}

// Four leaves: one peak, the latest (index 3, position 4) climbs two
// levels. Items: sibling leaf 2, then node 2. No left peaks.

test two_climb_steps_verify() {
  let other =
    fn(i: Int) { builtin.keccak_256(builtin.integer_to_bytearray(True, 1, i)) }
  let l3 = leaf(3, other(9))
  let l3_hash = scale_encode_beefy_mmr_leaf(l3) |> builtin.keccak_256
  let node2 = merge(other(0), other(1))
  let root = merge(node2, merge(other(2), l3_hash))
  verify_latest_leaf(l3, 4, as_data([other(2), node2]), root)
}

test even_count_missing_sibling_rejected() fail {
  let (l5, items, root) = even_case()
  expect [left_peak, _] = items
  verify_latest_leaf(l5, 6, as_data([left_peak]), root)
}

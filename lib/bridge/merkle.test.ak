use aiken/builtin
use aiken/collection/list
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/merkle.{leaf_root, verify_mmr_leaf, verify_multiproof}
use bridge/test_fixtures as fx
use bridge/types.{AuthoritySetCommitment, BeefyMmrLeaf}

// MMR: every leaf of every size 1..12 against the reference builder.

fn all_leaves_verify(count: Int) -> Bool {
  let hashes = list.map(list.range(0, count - 1), fx.dummy_leaf_hash)
  let root = fx.mmr_root(hashes)
  list.all(
    list.range(0, count - 1),
    fn(i) {
      expect Some(h) = list.at(hashes, i)
      verify_mmr_leaf(root, h, i, count, fx.mmr_proof(hashes, i))
    },
  )
}

test mmr_all_leaves_1_to_12() {
  list.all(list.range(1, 12), all_leaves_verify)
}

// MIP: block_number = 1, one leaf, no items, root = leaf hash.
test mmr_single_leaf() {
  let h = fx.dummy_leaf_hash(0)
  verify_mmr_leaf(h, h, 0, 1, [])
}

// MIP: a leaf that is itself a peak (count 5): no siblings, left peaks only.
test mmr_leaf_is_peak() {
  let hashes = list.map(list.range(0, 4), fx.dummy_leaf_hash)
  let items = fx.mmr_proof(hashes, 4)
  and {
    list.length(items) == 1,
    leaf_root(fx.dummy_leaf_hash(4), 4, 5, items) == fx.merge(
      fx.dummy_leaf_hash(4),
      fx.mmr_root(list.take(hashes, 4)),
    ),
  }
}

// MIP: leaf under the middle peak of three (count 7, index 5): items are
// P1, the sibling, then P3 as R; root = H(H(P3 || P2) || P1).
test mmr_three_peaks() {
  let hashes = list.map(list.range(0, 6), fx.dummy_leaf_hash)
  let p1 = fx.mmr_root(list.take(hashes, 4))
  let h4 = fx.dummy_leaf_hash(4)
  let h5 = fx.dummy_leaf_hash(5)
  let p2 = fx.merge(h4, h5)
  let p3 = fx.dummy_leaf_hash(6)
  and {
    fx.mmr_proof(hashes, 5) == [p1, h4, p3],
    leaf_root(h5, 5, 7, [p1, h4, p3]) == fx.merge(fx.merge(p3, p2), p1),
    fx.mmr_root(hashes) == fx.merge(fx.merge(p3, p2), p1),
  }
}

test mmr_wrong_item_rejected() {
  let hashes = list.map(list.range(0, 6), fx.dummy_leaf_hash)
  let root = fx.mmr_root(hashes)
  expect [first, ..rest] = fx.mmr_proof(hashes, 5)
  !verify_mmr_leaf(
    root,
    fx.dummy_leaf_hash(5),
    5,
    7,
    [fx.keccak(first), ..rest],
  )
}

test mmr_extra_item_fails() fail {
  let hashes = list.map(list.range(0, 6), fx.dummy_leaf_hash)
  let items = list.concat(fx.mmr_proof(hashes, 5), [fx.dummy_leaf_hash(9)])
  leaf_root(fx.dummy_leaf_hash(5), 5, 7, items) != ""
}

test mmr_missing_item_fails() fail {
  let hashes = list.map(list.range(0, 6), fx.dummy_leaf_hash)
  expect [_, ..items] = fx.mmr_proof(hashes, 5)
  leaf_root(fx.dummy_leaf_hash(5), 5, 7, items) != ""
}

test mmr_index_out_of_range_fails() fail {
  leaf_root(fx.dummy_leaf_hash(0), 1, 1, []) != ""
}

// Golden vectors from the previous right-fold verifier: the proven leaf is
// its own peak, so the items are the left peaks.

test mmr_vector_552_of_553() {
  let leaf =
    BeefyMmrLeaf {
      version: 0,
      parent_number: 552,
      parent_hash: #"c40e4fe32fa489a14783829c1e6eb264aec75b012ff58ad82b165386e24a3279",
      next_authority_set: AuthoritySetCommitment(
        1,
        1,
        #"ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
      ),
      extra: "",
    }
  verify_mmr_leaf(
    #"184d38dc3f285e2fda58e07212aec48e479f5d33a491ff805231954bfc5b2af3",
    scale_encode_beefy_mmr_leaf(leaf) |> builtin.keccak_256,
    552,
    553,
    [
      #"48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
      #"9535761693a1e47e66817cdf25371c1d64ef318ee8c85ce67d3d88b12aaa1b83",
      #"6403a4149a189e4f9ab21045adee353c5ba4d878600f8d23e6eaba76d0ac6269",
    ],
  )
}

test mmr_vector_600_of_601() {
  let leaf =
    BeefyMmrLeaf {
      version: 0,
      parent_number: 600,
      parent_hash: #"9b9462bf599ab609ea9917918e6b69b54b2bff8b7be6fc0de8984b55f5fbb057",
      next_authority_set: AuthoritySetCommitment(
        1,
        1,
        #"ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
      ),
      extra: "",
    }
  verify_mmr_leaf(
    #"023bf85dd76a4d6b9d5a5020c083a2a82719c049d4091325e735c5d0fe625c0e",
    scale_encode_beefy_mmr_leaf(leaf) |> builtin.keccak_256,
    600,
    601,
    [
      #"48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
      #"1f86e403238b1ce4aa6cd5c665e09821eb5a77acc6558c3e5d0192ec66bc1dee",
      #"d8f44f672c85e903549242cfcfd619432e692386a684d99fce21ca863bc10869",
      #"54d7061256cecc20b599f9a3331b9298b607a7f95cf3ee40cd1a50ab66792ae3",
    ],
  )
}

// Generator cross-check: the Aiken reference builder reproduces the roots
// the TypeScript generator signed.

test mmr_roots_match_generator() {
  list.all(
    [
      fx.a_no_handover,
      fx.b_handover,
      fx.c_next_signs_same,
      fx.d_skip_two,
      fx.e_block_one,
    ],
    fn(s) { fx.mmr_root(fx.mmr_hashes(s)) == s.mmr_root },
  )
}

// MIP: keyset root over seats (1, 2, 1) is H(H(H(l1) || H(l2)) || H(l3)).
test keyset_root_matches_generator() {
  fx.merge(
    fx.merge(fx.keccak(fx.leaf_at(0)), fx.keccak(fx.leaf_at(1))),
    fx.keccak(fx.leaf_at(2)),
  ) == fx.keyset_root
}

// Multiproof: every signer subset yields its leaves in tree order.

test multiproof_subsets() {
  list.all(
    [[0, 1, 2], [0, 1], [0, 2], [1, 2], [0], [1], [2]],
    fn(subset) {
      verify_multiproof(fx.keyset_root, fx.multiproof(subset)) == list.map(
        subset,
        fx.leaf_at,
      )
    },
  )
}

test multiproof_wrong_root_fails() fail {
  verify_multiproof(fx.keccak(fx.keyset_root), fx.multiproof([0, 1, 2])) != []
}

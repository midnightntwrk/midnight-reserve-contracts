use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/types.{
  AuthoritySetCommitment, BeefyMmrLeaf, Leaf, Peak, ProofNodeRec,
}

fn merge_nodes(a: ByteArray, b: ByteArray) -> ByteArray {
  bytearray.concat(a, b) |> builtin.keccak_256
}

/// Prove `latest_mmr_leaf` is bound into `mmr_root`. The leaf hash is
/// `keccak256(scale_encode_beefy_mmr_leaf(leaf))`; the proof items are
/// folded onto it right-to-left. Only the latest leaf is ever proven, so
/// the fold needs no leaf-position bookkeeping.
pub fn verify_mmr_leaf(
  latest_mmr_leaf: BeefyMmrLeaf,
  mmr_proof: Data<List<Peak>>,
  mmr_root: ByteArray,
) {
  let hash = scale_encode_beefy_mmr_leaf(latest_mmr_leaf) |> builtin.keccak_256

  mmr_root == calculate_mmr_root(mmr_proof, hash)
}

fn calculate_mmr_root(mmr_proof: Data<List<Peak>>, leaf_hash: ByteArray) {
  list.foldr(
    mmr_proof |> builtin.un_list_data,
    leaf_hash,
    fn(peak, acc) {
      peak
        |> builtin.un_b_data
        |> bytearray.concat(acc, _)
        |> builtin.keccak_256
    },
  )
}

test mmr_basic_proof_1() {
  let mmr_root =
    #"184d38dc3f285e2fda58e07212aec48e479f5d33a491ff805231954bfc5b2af3"

  let beefy_leaf =
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

  let hashed_leaf =
    scale_encode_beefy_mmr_leaf(beefy_leaf) |> builtin.keccak_256

  let peaks =
    [
      #"48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
      #"9535761693a1e47e66817cdf25371c1d64ef318ee8c85ce67d3d88b12aaa1b83",
      #"6403a4149a189e4f9ab21045adee353c5ba4d878600f8d23e6eaba76d0ac6269",
    ]

  mmr_root == list.foldr(
    peaks,
    hashed_leaf,
    fn(peak, acc) {
      bytearray.concat(acc, peak)
        |> builtin.keccak_256
    },
  )
}

test mmr_basic_proof_2() {
  let mmr_root =
    #"023bf85dd76a4d6b9d5a5020c083a2a82719c049d4091325e735c5d0fe625c0e"

  let beefy_leaf =
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

  let hashed_leaf =
    scale_encode_beefy_mmr_leaf(beefy_leaf) |> builtin.keccak_256

  let peaks =
    [
      #"48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
      #"1f86e403238b1ce4aa6cd5c665e09821eb5a77acc6558c3e5d0192ec66bc1dee",
      #"d8f44f672c85e903549242cfcfd619432e692386a684d99fce21ca863bc10869",
      #"54d7061256cecc20b599f9a3331b9298b607a7f95cf3ee40cd1a50ab66792ae3",
    ]

  mmr_root == list.foldr(
    peaks,
    hashed_leaf,
    fn(peak, acc) {
      bytearray.concat(acc, peak)
        |> builtin.keccak_256
    },
  )
}

/// Verify the give multi member merkle proof while
/// also extracting the leaves during traversal
pub fn verify_merkle_multi_proof_get_leaves(
  root: ByteArray,
  proof: ProofNodeRec,
) -> List<Leaf> {
  let
    calculated_hash,
    leaves,
  <- do_verify_merkle_multi_proof_get_leaves(proof, [])

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

use aiken/builtin
use aiken/primitive/bytearray
use bridge/types.{Leaf, ProofNodeRec}

fn merge_nodes(a: ByteArray, b: ByteArray) -> ByteArray {
  bytearray.concat(a, b) |> builtin.keccak_256
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

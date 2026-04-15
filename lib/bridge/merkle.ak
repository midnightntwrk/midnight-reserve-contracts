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
// // fails because each leaf contains member + stake |> keccak_256
// // TODO: test needs to be replaced with updated values
// test verify_merkle_multi_proof_get_leaves_1() {
//   let x: ProofNodeRec =
//     [
//       as_data(
//         [
//           [
//             as_data(
//               [
//                 #"2b61e2fc26f9440e8ab4dac2a9257510a5c11d56db1fa56f5f7e24cfa227e464",
//                 #"3d5e37ef0229d121e6e644c4a0d8680cc3af892eec11b865c0d83e9d9cb0b087",
//               ],
//             ),
//             as_data(
//               #"d2e4d978b047dbd39f53bbcc249f07bc3ca4ed154499cf055df8124bb81db9c1",
//             ),
//           ],
//           [
//             as_data(
//               #"d7d428326173db529e5207b6d907b69aa9288fcd37b792c7458706ea8603c86c",
//             ),
//             as_data(
//               [
//                 #"9b862519cc6f905c7baf6741bb7593ed7d63655e4e4a5d38d68204aa9b3c43d6",
//                 #"0ca08abbdcbe73bd5350e1b83b5b4db36913936173ba62587f7a8c6985f9aa20",
//               ],
//             ),
//           ],
//         ],
//       ),
//       as_data(
//         [
//           #"71d1061a002931d5f7b622705a864c507166d2694a581006bda0aa545fc5145c",
//           #"819a9ac0e4050a01b8f38fd987a294c8032924f6cf14428a2e89621766ad49e8",
//         ],
//       ),
//     ]

//   let leaves =
//     verify_merkle_multi_proof_get_leaves(
//       #"ef2a9efb4752054f1717a5aa928721986f7bd6c6e5144d627e1691a4a77bc047",
//       x,
//     )

//   leaves != []
// }

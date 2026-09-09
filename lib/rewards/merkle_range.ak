//// Sorted Merkle multiproof with contiguity (spec §6). The proof is the
//// bridge's five-shape DFS format (`bridge/merkle.ak`), keccak-256
//// throughout. The revealed leaves must form one contiguous block of the
//// sorted tree: in terminal order the proof reads `hash* leaf+ hash*`.
////
//// The DFS visits terminals right-to-left. That pattern is its own
//// reverse, so the state machine runs directly in visit order and
//// `Inside` carries the key of the leftmost leaf seen so far.

use aiken/builtin
use bridge/types.{ProofNodeRec}

/// Contiguity state over the terminal items of the proof.
pub type Reveal {
  Before
  Inside(ByteArray)
  After
}

/// A decoded 45-byte leaf: `ack(1) ++ skh(28) ++ amount(16, u128 BE)`.
pub type RewardLeaf {
  ack: Int,
  key: ByteArray,
  amount: Int,
}

/// Decode a leaf already length-checked by `verify_range`.
pub fn parse_leaf(leaf: ByteArray) -> RewardLeaf {
  RewardLeaf {
    ack: builtin.index_bytearray(leaf, 0),
    key: leaf_key(leaf),
    amount: builtin.slice_bytearray(29, 16, leaf)
      |> builtin.bytearray_to_integer(True, _),
  }
}

/// Recompute the root from `proof` and return the revealed leaves in
/// left-to-right order. Fails unless exactly one contiguous, non-empty
/// block of leaves is revealed and their keys are strictly ascending.
pub fn verify_range(root: ByteArray, proof: ProofNodeRec) -> List<ByteArray> {
  let hash, leaves, state <- do_verify(proof, [], Before)

  expect hash == root

  when state is {
    Before -> fail
    _ -> leaves
  }
}

fn leaf_key(leaf: ByteArray) -> ByteArray {
  builtin.slice_bytearray(1, 28, leaf)
}

fn merge(a: ByteArray, b: ByteArray) -> ByteArray {
  builtin.append_bytearray(a, b) |> builtin.keccak_256
}

fn on_leaf(state: Reveal, leaf: ByteArray) -> Reveal {
  expect builtin.length_of_bytearray(leaf) == 45
  let key = leaf_key(leaf)
  when state is {
    Before -> Inside(key)
    Inside(right) -> {
      expect builtin.less_than_bytearray(key, right)
      Inside(key)
    }
    After -> fail
  }
}

fn on_hash(state: Reveal, hash: ByteArray) -> Reveal {
  expect builtin.length_of_bytearray(hash) == 32
  when state is {
    Before -> Before
    _ -> After
  }
}

/// Same five node shapes as `bridge/merkle.ak`: `[leaf]`, `[list, list]`,
/// `[list, hash]`, `[hash, list]`, `[leaf, leaf]`. The right item of a
/// pair is folded first so terminals are visited right-to-left.
fn do_verify(
  proof: ProofNodeRec,
  leaves: List<ByteArray>,
  state: Reveal,
  callback,
) {
  when proof is {
    [leaf] -> {
      let leaf = leaf |> builtin.un_b_data
      callback(builtin.keccak_256(leaf), [leaf, ..leaves], on_leaf(state, leaf))
    }
    [branch1, branch2] ->
      builtin.choose_data(
        branch1,
        fail,
        fail,
        builtin.choose_data(
          branch2,
          fail,
          fail,
          {
            let
              hash2,
              leaves,
              state,
            <- do_verify(branch2 |> builtin.un_list_data, leaves, state)

            let
              hash1,
              leaves,
              state,
            <- do_verify(branch1 |> builtin.un_list_data, leaves, state)

            callback(merge(hash1, hash2), leaves, state)
          },
          fail,
          {
            let hash2 = branch2 |> builtin.un_b_data

            let
              hash1,
              leaves,
              state,
            <-
              do_verify(
                branch1 |> builtin.un_list_data,
                leaves,
                on_hash(state, hash2),
              )

            callback(merge(hash1, hash2), leaves, state)
          },
        ),
        fail,
        builtin.choose_data(
          branch2,
          fail,
          fail,
          {
            let hash1 = branch1 |> builtin.un_b_data

            let
              hash2,
              leaves,
              state,
            <- do_verify(branch2 |> builtin.un_list_data, leaves, state)

            callback(merge(hash1, hash2), leaves, on_hash(state, hash1))
          },
          fail,
          {
            let leaf1 = branch1 |> builtin.un_b_data
            let leaf2 = branch2 |> builtin.un_b_data
            let state = on_leaf(state, leaf2)

            callback(
              merge(builtin.keccak_256(leaf1), builtin.keccak_256(leaf2)),
              [leaf1, leaf2, ..leaves],
              on_leaf(state, leaf1),
            )
          },
        ),
      )
    _ -> fail
  }
}

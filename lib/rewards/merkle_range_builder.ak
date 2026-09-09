//// Test-side tree and proof builder for `rewards/merkle_range`. Tree rule
//// (spec §6, a pallet requirement): leaves hashed individually, pairs merged
//// left-to-right per level, a trailing odd node promoted unchanged. Not
//// imported by validators.

use aiken/builtin
use aiken/collection/list
use bridge/types.{ProofNodeRec}

type Node {
  LeafNode { index: Int, leaf: ByteArray, hash: ByteArray }
  BranchNode { hash: ByteArray, left: Node, right: Node }
}

/// A subtree as it appears in a proof.
type Item {
  Hidden(ByteArray)
  Revealed(ByteArray)
  Sub(List<Data>)
}

pub fn build_root(leaves: List<ByteArray>) -> ByteArray {
  build_tree(leaves) |> node_hash
}

/// Proof revealing leaf indices `from..to` inclusive.
pub fn build_proof(leaves: List<ByteArray>, from: Int, to: Int) -> ProofNodeRec {
  build_proof_with(leaves, fn(i) { i >= from && i <= to })
}

/// Proof revealing an arbitrary index set (for non-contiguous negatives).
pub fn build_proof_indices(
  leaves: List<ByteArray>,
  indices: List<Int>,
) -> ProofNodeRec {
  build_proof_with(leaves, fn(i) { list.has(indices, i) })
}

fn build_proof_with(
  leaves: List<ByteArray>,
  revealed: fn(Int) -> Bool,
) -> ProofNodeRec {
  when item_of(build_tree(leaves), revealed) is {
    Hidden(_) -> fail @"nothing revealed"
    Revealed(leaf) -> [builtin.b_data(leaf)]
    Sub(items) -> items
  }
}

fn build_tree(leaves: List<ByteArray>) -> Node {
  leaves
    |> list.indexed_map(
        fn(index, leaf) {
          LeafNode { index, leaf, hash: builtin.keccak_256(leaf) }
        },
      )
    |> reduce
}

fn reduce(level: List<Node>) -> Node {
  when level is {
    [root] -> root
    _ -> reduce(pair_up(level))
  }
}

fn pair_up(level: List<Node>) -> List<Node> {
  when level is {
    [] -> []
    [odd] -> [odd]
    [left, right, ..rest] -> {
      let hash =
        builtin.append_bytearray(node_hash(left), node_hash(right))
          |> builtin.keccak_256
      [BranchNode { hash, left, right }, ..pair_up(rest)]
    }
  }
}

fn node_hash(node: Node) -> ByteArray {
  when node is {
    LeafNode { hash, .. } -> hash
    BranchNode { hash, .. } -> hash
  }
}

fn item_of(node: Node, revealed: fn(Int) -> Bool) -> Item {
  when node is {
    LeafNode { index, leaf, hash } ->
      if revealed(index) {
        Revealed(leaf)
      } else {
        Hidden(hash)
      }
    BranchNode { hash, left, right } -> {
      let l = item_of(left, revealed)
      let r = item_of(right, revealed)
      when (l, r) is {
        (Hidden(_), Hidden(_)) -> Hidden(hash)
        _ -> Sub([encode(l, r), encode(r, l)])
      }
    }
  }
}

/// A revealed leaf is raw bytes only next to another revealed leaf; next
/// to a hash or a list it is wrapped as `[leaf]` so the verifier hashes it.
fn encode(item: Item, sibling: Item) -> Data {
  when item is {
    Hidden(hash) -> builtin.b_data(hash)
    Sub(items) -> builtin.list_data(items)
    Revealed(leaf) ->
      when sibling is {
        Revealed(_) -> builtin.b_data(leaf)
        _ -> builtin.list_data([builtin.b_data(leaf)])
      }
  }
}

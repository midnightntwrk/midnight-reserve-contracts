use aiken/builtin
use aiken/collection/list
use aiken/math.{log2}
use aiken/primitive/bytearray
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/types.{
  AuthoritySetCommitment, BeefyMmrLeaf, MmrLeaf, Node, RelayChainProof,
}

const shift_array =
  #"0000000000000000000000000000000000000000000000000000000000000001"

pub fn verify_mmr_leaf(
  beefy_activation_block: Int,
  relay_proof: RelayChainProof,
  mmr_root: ByteArray,
) {
  let RelayChainProof {
    latest_mmr_leaf: BeefyMmrLeaf { parent_number, k_index, leaf_index, .. } as latest,
    mmr_proof,
    mmr_subtree_proof,
    ..
  } = relay_proof

  let hash = scale_encode_beefy_mmr_leaf(latest) |> builtin.keccak_256

  let mmr_leaf_count = parent_number - beefy_activation_block + 1

  mmr_root == calculate_mmr_root(
    mmr_proof |> builtin.un_list_data,
    mmr_subtree_proof,
    MmrLeaf(k_index, leaf_index, hash),
    mmr_leaf_count,
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
      k_index: 552,
      leaf_index: 552,
    }

  let codec_leaf = scale_encode_beefy_mmr_leaf(beefy_leaf)

  let hashed_leaf = codec_leaf |> builtin.keccak_256

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

fn calculate_mmr_root(
  mmr_proof: List<Data<ByteArray>>,
  subtree_proof: Data<List<List<Node>>>,
  leaf: MmrLeaf,
  mmr_leaf_count: Int,
) {
  let subtree = subtree_heights(mmr_leaf_count)

  todo
}

fn subtree_heights(leaves_length: Int) -> List<Pair<Int, Int>> {
  if leaves_length == 0 {
    []
  } else {
    let log = log2(leaves_length)

    let two_exp =
      builtin.bytearray_to_integer(
        True,
        builtin.shift_bytearray(shift_array, log),
      )
    let current = leaves_length - two_exp

    [Pair(log, two_exp), ..subtree_heights(current)]
  }
}

fn calculate_subtree_proof() {
  todo
}

pub fn verify_merkle_multi_proof(
  root: ByteArray,
  leaves: List<Node>,
  proof: Data<List<List<Node>>>,
) -> Bool {
  expect [upper, ..rest] = proof |> builtin.un_list_data

  expect [root_node] =
    calculate_root(leaves, upper |> builtin.un_list_data, rest)

  root == root_node.hash
}

fn combine_nodes(x: Node, y: Node, callback) {
  let Node { k_index, hash } = x
  let next_k_index = k_index / 2
  let next_hash = do_hash(hash, y.hash)

  callback(next_k_index, next_hash)
}

fn calculate_root(
  current_layer: List<Node>,
  upper_layer: List<Data<Node>>,
  rest: List<Data<List<Node>>>,
) -> List<Node> {
  when current_layer is {
    [] -> []
    [x] -> {
      let Node { k_index, hash } = x
      let next_k_index = k_index / 2
      let next_hash = hash

      merge_next_layer(next_k_index, next_hash, [], upper_layer, rest)
    }
    [x, y, ..xs] -> {
      let next_k_index, next_hash <- combine_nodes(x, y)

      merge_next_layer(next_k_index, next_hash, xs, upper_layer, rest)
    }
  }
}

fn fold_rest(current_layer: List<Node>) {
  when current_layer is {
    [] -> current_layer
    [x] -> {
      let Node { k_index, hash } = x
      let next_k_index = k_index / 2
      let next_hash = hash

      [Node(next_k_index, next_hash)]
    }
    [x, y, ..xs] -> {
      let next_k_index, next_hash <- combine_nodes(x, y)

      [Node(next_k_index, next_hash), ..fold_rest(xs)]
    }
  }
}

fn do_hash(hash1: ByteArray, hash2: ByteArray) -> ByteArray {
  bytearray.concat(hash1, hash2) |> builtin.keccak_256
}

fn merge_next_layer(
  k_index: Int,
  hash: ByteArray,
  current_layer: List<Node>,
  upper_nodes: List<Data<Node>>,
  remaining_proofs: List<Data<List<Node>>>,
) -> List<Node> {
  let next_layer =
    when upper_nodes is {
      [] -> [Node(k_index, hash), ..fold_rest(current_layer)]
      [upper_item, ..others] -> {
        expect Node { k_index: upper_k_index, .. } as upper_item = upper_item
        let upper_k_index = upper_k_index |> builtin.un_i_data

        if upper_k_index > k_index {
          [
            Node(k_index, hash),
            ..calculate_root(current_layer, upper_nodes, remaining_proofs)
          ]
        } else {
          [
            upper_item,
            ..merge_next_layer(
              k_index,
              hash,
              current_layer,
              others,
              remaining_proofs,
            )
          ]
        }
      }
    }

  when remaining_proofs is {
    [] -> fold_rest(next_layer)
    [next_upper, ..remaining_proofs] ->
      calculate_root(
        next_layer,
        next_upper |> builtin.un_list_data,
        remaining_proofs,
      )
  }
}

//// Test-only fixtures for the bridge: three secp256k1 keys with seats
//// `(1, 2, 1)` (the MIP §Test vectors committee), signed scenarios generated
//// off chain with `@noble/curves`, a reference MMR builder, multiproof
//// shapes, and transaction builders. Not imported by any validator.

use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/types.{
  AuthoritySetCommitment, BeefyConsensusState, BeefyMmrLeaf, BeefyThreshold,
  BridgeUpdate,
}
use cardano/address.{Address, Script}
use cardano/assets.{add, from_lovelace}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use config

/// A signed commitment over an MMR whose last leaf names `next_id`; `sigs` are in key order.
pub type Scenario {
  set_id: Int,
  block_number: Int,
  next_id: Int,
  parent_hash: ByteArray,
  mmr_root: ByteArray,
  sigs: List<ByteArray>,
}

pub const seats = [1, 2, 1]

pub const seat_count = 4

pub const keys =
  [
    #"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    #"02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    #"02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
  ]

pub const keyset_root =
  #"052f9919c3c309e60ca131820fde7ce63f1d1d7d3746f066f5263b285c787096"

pub const a_no_handover =
  Scenario {
    set_id: 4,
    block_number: 7,
    next_id: 5,
    parent_hash: #"965fc89e6c02b012ddbdb7c3ac087e74e2dfc6cd8dcdc2efa28ddea9798fa4aa",
    mmr_root: #"41a1f6b1f3c53ab1064bb088307f9a124540713dce2b2f24f4d8f16f52c96b81",
    sigs: [
      #"b6cda229807a87bb7c59c97b06cdb7e166599f551102bcb3f2a22def7b7714c940a3d53d0e9e783adba9523761f38cae31560e6c11636ead6b4e9162dff9a559",
      #"3c44727df6c114d73c047d769769b9a198a6f0d53d9658544d70aa93bbd09400201cfe8174d399d33fca18c2f9811bc15eeb915dc2500de6d7e5901d38bf31d5",
      #"31115bc8b8452f484bf37c79d9c1cfd412447c6182e9de6171644accf7690d5c472528de76889d7a669f57c8cc777137bc1184eeb30e530ca9ff8db927bd1335",
    ],
  }

pub const b_handover =
  Scenario {
    set_id: 5,
    block_number: 8,
    next_id: 6,
    parent_hash: #"dac94472f7237cad8d6a810bbd1e431c9347ca475a545c4cde5a73ced01c9046",
    mmr_root: #"61cf07574ca90ca9af39b604fd6e22fc5db8524c73f66ca61052577e19ceb01f",
    sigs: [
      #"2e7f22f9c422e73a5bf1ee45be460e4989018cb2fa4fc343214c651dd04c2ada6794ec4794e81e8ad5c058dab9ab9a2c0b708d62c95cd98c142b4a252bf53977",
      #"7c6fdfc2f2b5f2f14ef2d689161e761503f298d0a1cbd8b6f7367b280089903e2c3dcecf355878c6efcfeb71d4e05fc96d84efa6cbb3e65dc6f56db5ca46b270",
      #"133a5f60698f81e2adc708bc7a9b0e546aa4a850ec6c0427d5a9c9a19ed18c255662ba6d25af6c31a6d5e54634f7e2690fb97efeee3c21d4dc3024cc630927d7",
    ],
  }

pub const c_next_signs_same =
  Scenario {
    set_id: 5,
    block_number: 8,
    next_id: 5,
    parent_hash: #"dac94472f7237cad8d6a810bbd1e431c9347ca475a545c4cde5a73ced01c9046",
    mmr_root: #"ab31cfaba1c297d312edb073fc724ba37b51a917a85c5ac47bea366cfd097d1b",
    sigs: [
      #"6d10b8a78e8d54f81cff7c4be1d2fd3ddd4a44bf3c695f801fa3a0ba3cadb1af2f097ec0432a71d1082a997de064a97e9446a7cc2517117d463e1047e2a803ce",
      #"fbf32cee1e03111a59c862e550e393a8b7208c1ad63ba8f7941b2c663fbc26d85e7e0489a1bed0a3f3bfab7ce62451c6a482b840ca7a46f9d60849081eb7db6a",
      #"38e7fc1a8dda29670b6d978f3f79bb4f5c138f559add865250dd6593022810dd68a06b979ce750e7f1a430f80cd26d535ec64f17df576cb0bd3a04ca1ee60f1d",
    ],
  }

pub const d_skip_two =
  Scenario {
    set_id: 4,
    block_number: 7,
    next_id: 7,
    parent_hash: #"965fc89e6c02b012ddbdb7c3ac087e74e2dfc6cd8dcdc2efa28ddea9798fa4aa",
    mmr_root: #"b7d0106e7fd75b3bdb43be1bac17a1f67cffb70f0da8ac0e86c4bc306bde1ec6",
    sigs: [
      #"537f09ba25f9b161b1a6818ce056c371de6c5c671f817ee02651c1e29798f75a5697e431ab5756feec594b3c164df38b573545e1ec7eccb2dc4a141764bdf27d",
      #"f1123df552eff7faf0c48b0a9f60166e291b56c7262eacdf5ac202c44eaa8b91145562316b196ab9cd8aa62b71fea9b41f43bfe85291fa91a70d07a665204293",
      #"ecb639373d33ea1998da45cc71db68416f03148b96aac84dfed2e70a279f26a1717bcad151b2c466c2478670ad52ea20e0c6d34d7a2ff31721eda2785b3937b0",
    ],
  }

pub const e_block_one =
  Scenario {
    set_id: 4,
    block_number: 1,
    next_id: 5,
    parent_hash: #"e6a3bb74bc473a3946957387c05bbc678ae73ee52c5f286e2c171e29853869f4",
    mmr_root: #"bd94a82be9c947f261ac9f400c00c4573701a901cbc98ba8aa4a2ff3b15dccd3",
    sigs: [
      #"67fb7b8ddf58e9e04e265f74ad7547aad77e0d9384746215f16356734a6d85750c9a1576bf7bae3886f87c8c094ffb07a4f86fbd694a2cab46968eea185111c7",
      #"ba5ae64153efae9a1e69d6d1934c4255dd873cb9a69431c5eaebedd58030431579c9f3c6bf49b67fcfbf139bd049ff687ad03b02bf51dc621bff1378c71e8783",
      #"73f627e1f3a82fede434ac6b120abd5eb3d03bee4ad147f1e46173f9219359606c166a6260200311d218af230c9d077d173f5098968fdf70d12da58bc60f7707",
    ],
  }

pub fn merge(a: ByteArray, b: ByteArray) -> ByteArray {
  builtin.append_bytearray(a, b) |> builtin.keccak_256
}

pub fn keccak(b: ByteArray) -> ByteArray {
  builtin.keccak_256(b)
}

/// Authority leaves in key order.
pub const leaves =
  list.map2(
    keys,
    seats,
    fn(key, n) {
      bytearray.concat(key, builtin.integer_to_bytearray(False, 4, n))
    },
  )

pub fn committee(id: Int) -> AuthoritySetCommitment {
  AuthoritySetCommitment {
    validator_set_id: id,
    seat_count,
    keyset_commitment: keyset_root,
  }
}

pub const threshold = BeefyThreshold(2, 3, 0, 0)

pub fn state(
  current_id: Int,
  next_id: Int,
  latest_height: Int,
) -> BeefyConsensusState {
  BeefyConsensusState {
    latest_mmr_root: keccak("genesis"),
    latest_height,
    beefy_activation_block: 1,
    current_committee: committee(current_id),
    next_committee: committee(next_id),
  }
}

pub fn leaf(s: Scenario) -> BeefyMmrLeaf {
  BeefyMmrLeaf {
    version: 0,
    parent_number: s.block_number - 1,
    parent_hash: s.parent_hash,
    next_authority_set: committee(s.next_id),
    extra: "",
  }
}

/// Filler leaf hash for block `i + 1`, matching the generator.
pub fn dummy_leaf_hash(i: Int) -> ByteArray {
  keccak(builtin.integer_to_bytearray(False, 4, i))
}

/// All leaf hashes of the scenario's MMR, the signed leaf last.
pub fn mmr_hashes(s: Scenario) -> List<ByteArray> {
  list.concat(
    list.map(list.range(0, s.block_number - 2), dummy_leaf_hash),
    [scale_encode_beefy_mmr_leaf(leaf(s)) |> keccak],
  )
}

// Reference MMR: peaks by descending size, each a full binary tree, bagged
// right to left as `H(right || left)`.

fn largest_pow2_at_most(n: Int, acc: Int) -> Int {
  if acc * 2 <= n {
    largest_pow2_at_most(n, acc * 2)
  } else {
    acc
  }
}

fn tree_root(hashes: List<ByteArray>) -> ByteArray {
  when hashes is {
    [h] -> h
    _ -> {
      let half = list.length(hashes) / 2
      merge(
        tree_root(list.take(hashes, half)),
        tree_root(list.drop(hashes, half)),
      )
    }
  }
}

fn peak_roots(hashes: List<ByteArray>) -> List<ByteArray> {
  when hashes is {
    [] -> []
    _ -> {
      let size = largest_pow2_at_most(list.length(hashes), 1)
      [
        tree_root(list.take(hashes, size)),
        ..peak_roots(list.drop(hashes, size))
      ]
    }
  }
}

fn bag(peaks: List<ByteArray>) -> ByteArray {
  expect [right, ..lefts] = list.reverse(peaks)
  list.foldl(lefts, right, fn(left, acc) { merge(acc, left) })
}

pub fn mmr_root(hashes: List<ByteArray>) -> ByteArray {
  peak_roots(hashes) |> bag
}

/// Siblings bottom-up for `offset` inside a full tree.
fn siblings(hashes: List<ByteArray>, offset: Int) -> List<ByteArray> {
  when hashes is {
    [_] -> []
    _ -> {
      let half = list.length(hashes) / 2
      let left = list.take(hashes, half)
      let right = list.drop(hashes, half)
      if offset < half {
        list.concat(siblings(left, offset), [tree_root(right)])
      } else {
        list.concat(siblings(right, offset - half), [tree_root(left)])
      }
    }
  }
}

/// Proof items for leaf `index`: left peaks, climb siblings, then the bagged right peaks if any.
pub fn mmr_proof(hashes: List<ByteArray>, index: Int) -> List<ByteArray> {
  let size = largest_pow2_at_most(list.length(hashes), 1)
  if index >= size {
    [
      tree_root(list.take(hashes, size)),
      ..mmr_proof(list.drop(hashes, size), index - size)
    ]
  } else {
    let rights = peak_roots(list.drop(hashes, size))
    list.concat(
      siblings(list.take(hashes, size), index),
      when rights is {
        [] -> []
        _ -> [bag(rights)]
      },
    )
  }
}

// Multiproof shapes over the three leaves; `signers` are leaf indices.

fn node(items: List<Data>) -> Data {
  builtin.list_data(items)
}

fn raw(b: ByteArray) -> Data {
  builtin.b_data(b)
}

fn lone(i: Int) -> Data {
  node([raw(leaf_at(i))])
}

fn hashed(i: Int) -> Data {
  raw(keccak(leaf_at(i)))
}

pub fn leaf_with_parent(l: BeefyMmrLeaf, parent_number: Int) -> BeefyMmrLeaf {
  BeefyMmrLeaf { ..l, parent_number }
}

pub fn leaf_at(i: Int) -> ByteArray {
  expect Some(l) = list.at(leaves, i)
  l
}

pub fn multiproof(signers: List<Int>) -> Data {
  when signers is {
    [0, 1, 2] -> node([node([raw(leaf_at(0)), raw(leaf_at(1))]), lone(2)])
    [0, 1] -> node([node([raw(leaf_at(0)), raw(leaf_at(1))]), hashed(2)])
    [0, 2] -> node([node([lone(0), hashed(1)]), lone(2)])
    [1, 2] -> node([node([hashed(0), lone(1)]), lone(2)])
    [0] -> node([node([lone(0), hashed(1)]), hashed(2)])
    [1] -> node([node([hashed(0), lone(1)]), hashed(2)])
    [2] -> node([raw(merge(keccak(leaf_at(0)), keccak(leaf_at(1)))), lone(2)])
    _ -> fail
  }
}

/// Signatures for the multiproof leaves: the scenario's signature for signers, `""` otherwise.
pub fn signatures(
  s: Scenario,
  proof_leaves: List<Int>,
  signers: List<Int>,
) -> List<ByteArray> {
  list.map(
    proof_leaves,
    fn(i) {
      if list.has(signers, i) {
        expect Some(sig) = list.at(s.sigs, i)
        sig
      } else {
        ""
      }
    },
  )
}

/// The update for `s` with the multiproof over `proof_leaves` and signatures from `signers`.
pub fn update_with(
  s: Scenario,
  proof_leaves: List<Int>,
  signers: List<Int>,
) -> BridgeUpdate {
  BridgeUpdate {
    mmr_root: s.mmr_root,
    block_number: s.block_number,
    validator_set_id: s.set_id,
    signatures: signatures(s, proof_leaves, signers),
    leaf: leaf(s),
    mmr_proof: mmr_proof(mmr_hashes(s), s.block_number - 1),
    multiproof: multiproof(proof_leaves),
  }
}

/// The update for `s` signed by the quorum `k1, k2` over all three leaves.
pub fn update(s: Scenario) -> BridgeUpdate {
  update_with(s, [0, 1, 2], [0, 1])
}

// Transaction pieces for `committee_bridge_logic`.

pub const forever = config.committee_bridge_forever_hash

pub const forever_address = Address(Script(forever), None)

pub fn forever_output(st: BeefyConsensusState, ada: Int) -> Output {
  Output(
    forever_address,
    from_lovelace(ada) |> add(forever, "", 1),
    InlineDatum(st),
    None,
  )
}

pub fn forever_input(st: BeefyConsensusState, ada: Int) -> Input {
  Input(
    OutputReference(
      #"9999999999999999999999999999999999999999999999999999999999999999",
      0,
    ),
    forever_output(st, ada),
  )
}

pub const threshold_input =
  Input(
    OutputReference(
      #"9999999999999999999999999999999999999999999999999999999999999999",
      1,
    ),
    Output(
      Address(Script(config.beefy_signer_threshold_hash), None),
      from_lovelace(2_000_000) |> add(config.beefy_signer_threshold_hash, "", 1),
      InlineDatum(threshold),
      None,
    ),
  )

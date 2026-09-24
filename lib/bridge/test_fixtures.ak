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
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{add, from_lovelace}
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference}
use config
use upgradable/types.{UpgradeState} as ut

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
    mmr_root: #"ab4eac1bdc5cd05fa0f638c295f42ad024b1dff4d5f2436aa001e3294d9422db",
    sigs: [
      #"f1c0b4022c7273144299b89415517f38c81f606568ff0885ece7421658fc777b2eb832afae575f8e59bc12e07d9c4a11a1845bd6cdcfdbe2336b6251cf7184cd",
      #"cf10e35facd47fba8146e27dc018b88ac20b3d282120e1f88b762f3a7901441333a4151917d03d03ec9dfc93559651e450c2eb337b28d1b21971b0263736c9df",
      #"fd1d87817867fbf24b7db91a7ad7220a657957a0268aaf412daaeb539c63936f63c3b0b29235a1ba041f8ce28ac36dc35d2599d1aa5b0a414d8edf8397d9907a",
    ],
  }

pub const b_handover =
  Scenario {
    set_id: 5,
    block_number: 8,
    next_id: 6,
    parent_hash: #"dac94472f7237cad8d6a810bbd1e431c9347ca475a545c4cde5a73ced01c9046",
    mmr_root: #"350501af9cf6627e4642f864de66d37b8f6e8097edea3662bc93d51450997de3",
    sigs: [
      #"df001efc2133466b70898c14d969762677eca122f30c4e6b48ea8202de437cc978ad2bcb5ae5df974ca6b888c30074717b59b9c3bdfabf9be1538e038ebfe43c",
      #"287eca8fc8ee46b6fc0c1215e3fda4c6941ac810b5d117a7ca4b6e4c3ecf2fcf1081414900116d1f4f7c3b99ea38fcd1bf0eccfea2d6a58a1ccec850917a51a3",
      #"85a6c644e9f88db5f3776ed6e0eed7c3ad5069ba600c1ad13cb3b13fa9c6f21701109844c8d7adc4a588c82f4162f035dd75fa6c705a80f4d47d73bb0de36e32",
    ],
  }

pub const c_next_signs_same =
  Scenario {
    set_id: 5,
    block_number: 8,
    next_id: 5,
    parent_hash: #"dac94472f7237cad8d6a810bbd1e431c9347ca475a545c4cde5a73ced01c9046",
    mmr_root: #"09a9b9a4849407362b300c11edfcd6c374e0fc97adfa07be1f3918c141fd4222",
    sigs: [
      #"00bf20c7a825939114e3d91a8922361a6a55810c1df7af38d1242b19c59e7e9235fed43c33b7914e6c2f074d2c89ae9d8d1b6326c63e83afaa2db4f4c0eb2cd0",
      #"d5e25fa58dc4e2be00709f74193d63cd0f59d61167d341d6cc2ec2c088af8e7340f84ec0d365a5df6164d5a71eb839f4932a2b4e2fb2f79c9257c521fdd14ea5",
      #"d1cd4216f21a7fcfdfb9368ea4a581534b84c0f2ccf50a7667bd11895700f9ec3e577b2d48d58027145a91f0d80fb26706c4ee45367b84b4f77549215fce321f",
    ],
  }

pub const d_skip_two =
  Scenario {
    set_id: 4,
    block_number: 7,
    next_id: 7,
    parent_hash: #"965fc89e6c02b012ddbdb7c3ac087e74e2dfc6cd8dcdc2efa28ddea9798fa4aa",
    mmr_root: #"ef52bd6c94015877ebf8ceda4e16c5cf2d817212950545538f7e81aed9d0959f",
    sigs: [
      #"4166c149f3ba0493cc6e564a4c5b07d49d5269b7e599177c6d81437288e00f9e63f3771a946ef8512d6c92c3d29fba99decf6de8a9ba156be0acaa67bdd03155",
      #"afcc4a4a1051d7755485fa6a2e05598e4566bd528e05a5a3ee05af449104821c56a8cd9a925116b1342875239f519f43d85d1d18f827c40bcc80b27dc13386d9",
      #"dfcc27a0ffbbe045219055ccff6d74bef973b13d5321019806f1074928ab6682757108b3af34ffdcc0c97ec38e5d53524a7773f5d4dd069c7ef94be77f81f2c7",
    ],
  }

pub const e_block_one =
  Scenario {
    set_id: 4,
    block_number: 1,
    next_id: 5,
    parent_hash: #"e6a3bb74bc473a3946957387c05bbc678ae73ee52c5f286e2c171e29853869f4",
    mmr_root: #"7f72af147167b4357ed7d5e4e46af13377da2bfec51758d5a1db116db213da56",
    sigs: [
      #"d4a5995cf3e397f8875924c6236ea8e6856d8e479c5fe011ed6fee62ed6cd4df77d35ac88099a7b53c09ee4f56ffaede81102fc94c2280cc6d0ba786c2a7b3a7",
      #"5a8ef390c10d34a89d9626f3e3fdfc62cca730c1228c6fe5b05763b742b662e623bf79ba3ce7dab50b727788a2c2e79b95695a131881a587c2fc1bce2a462cfb",
      #"cd1cd54759e001e5bc8db9553f408ad2eec7c1faec66e01f2f93dc277f4fde20306cf934fc596d5a442a1b9c8ece2edfc887809e08b1638d06728da877b0b90a",
    ],
  }

pub const f_current_hands_over =
  Scenario {
    set_id: 4,
    block_number: 9,
    next_id: 6,
    parent_hash: #"49864eae586f19ef7d817e5deca567bc44dc855c2399268cf9d522e0e1ae24d1",
    mmr_root: #"6c736878fde7da35a4a531008f147383b9068ed44aaf09c38dc66bb4d065080d",
    sigs: [
      #"10323211438bed9ac2410e8c11a0afcccf0a34a77a4ed298e2fc47d8faac69e808aa5f1e2cc59fa03ada073bbc79f752258348fc9e95cf94e2fe7445ec86e89c",
      #"f9dc223f2679bca70e0710df9bdec20d696218ec0c25f14f2bd376ac938db3904ec595df613f145fab1603e30f3a9a9f4fad07f0e5d9deb482029c18e78296b2",
      #"f247e2c7f2e69c57c99f9be2d22a8d0270008fa5d46e56cf4b256b4133429ee944e694cea4a970f9db4f9b65cb6c06b9a0ceedccf1c4b8da68ee4a3923d724b0",
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

/// A committee under a keyset that cannot verify any scenario's signatures.
pub fn other_committee(id: Int) -> AuthoritySetCommitment {
  AuthoritySetCommitment {
    validator_set_id: id,
    seat_count: 7,
    keyset_commitment: keccak(
      bytearray.concat("other", builtin.integer_to_bytearray(False, 4, id)),
    ),
  }
}

/// State where the current committee is the signing keyset and the next is not.
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
    next_committee: other_committee(next_id),
  }
}

/// State where the next committee is the signing keyset and the current is not.
pub fn state_next_signs(
  current_id: Int,
  next_id: Int,
  latest_height: Int,
) -> BeefyConsensusState {
  BeefyConsensusState {
    latest_mmr_root: keccak("genesis"),
    latest_height,
    beefy_activation_block: 1,
    current_committee: other_committee(current_id),
    next_committee: committee(next_id),
  }
}

/// The successor committee a scenario's leaf names: 9 seats under a keyset that is not the signing one.
pub fn leaf_next(id: Int) -> AuthoritySetCommitment {
  AuthoritySetCommitment {
    validator_set_id: id,
    seat_count: 9,
    keyset_commitment: keccak(
      bytearray.concat("next", builtin.integer_to_bytearray(False, 4, id)),
    ),
  }
}

pub fn leaf(s: Scenario) -> BeefyMmrLeaf {
  BeefyMmrLeaf {
    version: 0,
    parent_number: s.block_number - 1,
    parent_hash: s.parent_hash,
    next_authority_set: leaf_next(s.next_id),
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

/// A 64-byte inner-node preimage presented as a leaf: the root matches, the 37-byte guard must reject it.
pub fn multiproof_preimage_leaf() -> Data {
  node(
    [
      node([raw(bytearray.concat(keccak(leaf_at(0)), keccak(leaf_at(1))))]),
      lone(2),
    ],
  )
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

pub fn threshold_input_of(t: BeefyThreshold) -> Input {
  Input(
    OutputReference(
      #"9999999999999999999999999999999999999999999999999999999999999999",
      1,
    ),
    Output(
      Address(Script(config.beefy_signer_threshold_hash), None),
      from_lovelace(2_000_000)
        |> add(config.beefy_signer_threshold_hash, "", 1),
      InlineDatum(t),
      None,
    ),
  )
}

pub const threshold_input = threshold_input_of(threshold)

// Funding pool pieces.

pub const pool = config.committee_bridge_pool_hash

pub const pool_address = Address(Script(pool), None)

pub fn pool_output(ada: Int) -> Output {
  Output(pool_address, from_lovelace(ada), NoDatum, None)
}

/// A top-up someone sent to the pool credential with their own stake key; still pool money.
pub fn pool_input_staked(tag: Int, ada: Int) -> Input {
  Input(
    OutputReference(
      #"7777777777777777777777777777777777777777777777777777777777777777",
      tag,
    ),
    Output(
      Address(
        Script(pool),
        Some(
          Inline(
            VerificationKey(
              #"1111111111111111111111111111111111111111111111111111111111111111",
            ),
          ),
        ),
      ),
      from_lovelace(ada),
      NoDatum,
      None,
    ),
  )
}

pub fn pool_input(tag: Int, ada: Int) -> Input {
  Input(
    OutputReference(
      #"7777777777777777777777777777777777777777777777777777777777777777",
      tag,
    ),
    pool_output(ada),
  )
}

/// The two-stage `main` reference input naming `logic_hash` as the running logic.
pub fn two_stage_main_ref(logic_hash: ByteArray) -> Input {
  Input(
    OutputReference(
      #"8888888888888888888888888888888888888888888888888888888888888888",
      0,
    ),
    Output(
      Address(Script(config.committee_bridge_two_stage_hash), None),
      from_lovelace(2_000_000)
        |> add(config.committee_bridge_two_stage_hash, "main", 1),
      InlineDatum(UpgradeState(logic_hash, "", "", "", 0, 0)),
      None,
    ),
  )
}

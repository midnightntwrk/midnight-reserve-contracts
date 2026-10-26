//// Test-only fixtures for the bridge: the generated keys and signed
//// scenarios from `fixtures/bridge/vectors` (`bun tests/bridge/generate.ts`), a
//// reference MMR builder, multiproof shapes, and transaction builders. Not
//// imported by any validator.

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
use fixtures/bridge/vectors
use upgradable/types.{UpgradeState} as ut

/// Re-exports of the generated fixtures so tests keep one import.
pub type Scenario =
  vectors.Scenario

pub const seats = [1, 2, 1]

pub const seat_count = 4

pub const keys = vectors.keys

pub const keyset_root = vectors.keyset_root

pub const a_no_handover = vectors.a_no_handover

pub const b_handover = vectors.b_handover

pub const c_next_signs_same = vectors.c_next_signs_same

pub const d_skip_two = vectors.d_skip_two

pub const e_block_one = vectors.e_block_one

pub const f_current_hands_over = vectors.f_current_hands_over

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
    parent_number: s.parent_number,
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

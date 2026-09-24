//// Committee bridge types: the MIP `Data` layouts for the light-client
//// datum, the threshold datum, and the `committee_bridge_logic` redeemer.
//// Every constructor has index 0 and field order is the `Data` order.

/// A committee commitment: `validator_set_id` (u64), total `seat_count` (u32), and the keccak256 root over the deduplicated authority leaves.
pub type AuthoritySetCommitment {
  validator_set_id: Int,
  seat_count: Int,
  keyset_commitment: ByteArray,
}

/// The `pallet-beefy-mmr` leaf of a block; `extra` is empty in version 0.
pub type BeefyMmrLeaf {
  version: Int,
  parent_number: Int,
  parent_hash: ByteArray,
  next_authority_set: AuthoritySetCommitment,
  extra: ByteArray,
}

/// The light-client datum: the latest verified root and height plus the current and successor committees.
pub type BeefyConsensusState {
  latest_mmr_root: ByteArray,
  latest_height: Int,
  beefy_activation_block: Int,
  current_committee: AuthoritySetCommitment,
  next_committee: AuthoritySetCommitment,
}

/// The threshold datum: the quorum ratio and the funded-update fee cap (`base + per_signer * signers`, lovelace).
pub type BeefyThreshold {
  numerator: Int,
  denominator: Int,
  base: Int,
  per_signer: Int,
}

/// The `committee_bridge_logic` redeemer: a signed root, one signature per multiproof leaf in tree order (64 bytes, or empty for a non-signer), the leaf of `block_number`, and its proofs.
pub type BridgeUpdate {
  mmr_root: ByteArray,
  block_number: Int,
  validator_set_id: Int,
  signatures: List<ByteArray>,
  leaf: BeefyMmrLeaf,
  mmr_proof: List<ByteArray>,
  multiproof: Data,
}

/// A Merkle multiproof node, decoded lazily; see `bridge/merkle.ak` for the five accepted shapes.
pub type ProofNodeRec =
  List<Data>

/// An authority leaf: compressed secp256k1 key (33 bytes) followed by the seat count (u32 LE), 37 bytes.
pub type Leaf =
  ByteArray

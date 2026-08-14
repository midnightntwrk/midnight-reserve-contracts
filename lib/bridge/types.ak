/// A single validator's vote on a BEEFY commitment.
/// `signature` is a 65-byte ECDSA/secp256k1 recoverable signature over the
/// keccak256 hash of the SCALE-encoded commitment; `public_key` is the
/// validator's compressed secp256k1 public key.
pub type Vote {
  signature: ByteArray,
  public_key: ByteArray,
}

/// An entry in a BEEFY commitment's payload list. `id` is a short tag
/// identifying the payload kind (`"mh"` for the MMR root, see
/// `mmr_root_payload_id`); `data` is the payload body.
pub type Payload {
  id: ByteArray,
  data: ByteArray,
}

/// The signed body of a BEEFY finality proof, produced by the relay chain
/// for a given block. `payloads` carries the MMR root under the `"mh"` id.
/// `block_number` and `validator_set_id` identify where in relay chain
/// history the commitment was issued.
pub type Commitment {
  payloads: List<Payload>,
  block_number: Int,
  validator_set_id: Int,
}

/// A `Commitment` bundled with validator votes. Enough of those votes must
/// be valid and their combined seat count must meet the configured
/// threshold for `verify_mmr_update_proof` to accept it.
pub type SignedCommitment {
  commitment: Commitment,
  votes: List<Vote>,
}

/// Identifies a BEEFY authority set and binds its membership.
/// `id` is a monotonically increasing set identifier used to detect
/// rotations; `keyset_commitment` is the keccak256 binary Merkle root over
/// the set's deduplicated authority leaves (each leaf is
/// `pubkey || seat_count`, see the `Leaf` type). `len` is the total seat
/// count (with repetition) and is the quorum denominator.
pub type AuthoritySetCommitment {
  id: Int,
  len: Int,
  keyset_commitment: ByteArray,
}

/// A BEEFY MMR leaf summarising a relay chain block.
/// `next_authority_set` drives authority rotations: a new leaf whose
/// `next_authority_set.id` exceeds the current next set signals a
/// rotation. `extra` is empty in leaf version 0.1 and is the extension
/// point for per-block data. `version`, `parent_number`, and
/// `parent_hash` are not consulted by on-chain validation but are part of
/// the SCALE encoding whose keccak256 hash is the MMR leaf hash proven
/// against the signed MMR root.
pub type BeefyMmrLeaf {
  version: Int,
  parent_number: Int,
  parent_hash: ByteArray,
  next_authority_set: AuthoritySetCommitment,
  extra: ByteArray,
}

/// A recursive SCALE-encoded Merkle multi-proof node, decoded lazily via
/// `Data`. See `bridge/merkle.ak` for the five node shapes the on-chain
/// verifier accepts.
pub type ProofNodeRec =
  List<Data>

/// An MMR peak hash used by `calculate_mmr_root` when folding the proof
/// items onto the proven leaf hash.
pub type Peak =
  ByteArray

/// Relay-chain proof package: the signed commitment, the MMR leaf it
/// advances to, the MMR proof binding that leaf into the signed MMR root,
/// and the multi-member Merkle proof that binds the authority leaves used
/// to verify the votes into the relevant keyset commitment.
pub type RelayChainProof {
  signed_commitment: SignedCommitment,
  latest_mmr_leaf: BeefyMmrLeaf,
  mmr_proof: Data<List<Peak>>,
  proof: Data<ProofNodeRec>,
}

/// Redeemer payload passed to `committee_bridge_logic`. Presently a thin
/// wrapper around `RelayChainProof`; future proof transports can be added
/// as additional fields or variants without changing call sites.
pub type BeefyConsensusProof {
  relay: RelayChainProof,
}

/// SCALE payload id used inside a BEEFY `Commitment.payloads` list to
/// carry the signed MMR root (32 bytes). The on-chain verifier locates
/// the payload with this id, proves `latest_mmr_leaf` against it, and
/// stores it in the datum as `latest_mmr_root`.
pub const mmr_root_payload_id = "mh"

/// The on-chain datum tracking the BEEFY consensus checkpoint.
/// `latest_mmr_root` is the most recent quorum-verified MMR root;
/// downstream consumers read it via reference input and verify keccak256
/// MMR inclusion proofs against it. `latest_height` is the most recent
/// relay block whose commitment has been verified; new proofs must
/// strictly advance it. `current_committee` and `next_committee` define
/// which validators may sign commitments; each carries its total seat
/// count (`len`) as the quorum denominator. When a proof carries a leaf
/// whose next set has advanced, the current set shifts to the old next
/// set and the incoming leaf's `next_authority_set` becomes the new next
/// set. `beefy_activation_block` is carried through unchanged on-chain
/// and is reserved for off-chain consumers (e.g. the relay indexer).
pub type BeefyConsensusState {
  latest_mmr_root: ByteArray,
  latest_height: Int,
  beefy_activation_block: Int,
  current_committee: AuthoritySetCommitment,
  next_committee: AuthoritySetCommitment,
}

/// Seat threshold as a ratio. The required signed seat count for a
/// commitment is computed from the signing committee's total seat count
/// (`len`) using this ratio with the Substrate/BEEFY reference threshold
/// semantics. Spending rules for the threshold UTxO are defined by
/// `beefy_validation` in `validators/thresholds.ak`.
pub type BeefyThreshold {
  numerator: Int,
  denominator: Int,
}

/// A BEEFY authority leaf, as produced by the relay chain's deduplicated
/// authority-set Merkle tree. Byte layout: bytes `0..33` are the
/// compressed secp256k1 public key; bytes `33..41` are the validator's
/// seat count as a little-endian u64. `find_auth_in_leaves` slices the
/// key and seat count directly at these offsets.
pub type Leaf =
  ByteArray

/// A single validator's vote on a BEEFY commitment.
/// `signature` is a 65-byte ECDSA/secp256k1 recoverable signature over the
/// keccak256 hash of the SCALE-encoded commitment; `public_key` is the
/// validator's compressed secp256k1 public key.
pub type Vote {
  signature: ByteArray,
  public_key: ByteArray,
}

/// An entry in a BEEFY commitment's payload list. `id` is a short tag
/// identifying the payload kind (e.g. `"nc"` for the next-committee
/// commitment, see `next_committee_payload_id`); `data` is the payload body.
pub type Payload {
  id: ByteArray,
  data: ByteArray,
}

/// The signed body of a BEEFY finality proof, produced by the relay chain
/// for a given block. `payloads` carries one or more tagged payloads
/// (at minimum the MMR root; for authority rotations also the next-committee
/// payload). `block_number` and `validator_set_id` identify where in relay
/// chain history the commitment was issued.
pub type Commitment {
  payloads: List<Payload>,
  block_number: Int,
  validator_set_id: Int,
}

/// A `Commitment` bundled with validator votes. Enough of those votes must
/// be valid and their combined stake must meet the configured threshold for
/// `verify_mmr_update_proof` to accept it.
pub type SignedCommitment {
  commitment: Commitment,
  votes: List<Vote>,
}

/// Identifies a BEEFY authority set and binds its membership.
/// `id` is a monotonically increasing set identifier used to detect
/// rotations; `root` is the Merkle root over the set's authority leaves
/// (each leaf is `keccak256(pubkey) || stake`, see the `Leaf` type).
/// `len` is the number of leaves; it is carried so the SCALE-encoded MMR
/// leaf hash matches the relay chain's, but on-chain validation does not
/// read it directly.
pub type AuthoritySetCommitment {
  id: Int,
  len: Int,
  root: ByteArray,
}

/// A BEEFY MMR leaf summarising a relay chain block.
/// `next_authority_set` and `extra` drive authority rotations: a new leaf
/// whose `next_authority_set.id` exceeds the current next set signals a
/// rotation, and `extra` supplies the new set's total stake as a
/// big-endian unsigned integer. `version`, `parent_number`, and
/// `parent_hash` are not consulted by on-chain validation but are part of
/// the SCALE encoding whose keccak256 hash must match the `"nc"` payload
/// in the signed commitment.
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

/// Relay-chain proof package: the signed commitment, the MMR leaf it
/// advances to, and the multi-member Merkle proof that binds the authority
/// leaves used to verify the votes into the relevant authority set root.
pub type RelayChainProof {
  signed_commitment: SignedCommitment,
  latest_mmr_leaf: BeefyMmrLeaf,
  proof: Data<ProofNodeRec>,
}

/// Redeemer payload passed to `committee_bridge_logic`. Presently a thin
/// wrapper around `RelayChainProof`; future proof transports can be added
/// as additional fields or variants without changing call sites.
pub type BeefyConsensusProof {
  relay: RelayChainProof,
}

/// SCALE payload id used inside a BEEFY `Commitment.payloads` list to
/// carry the keccak256 hash of the SCALE-encoded next MMR leaf. The
/// on-chain verifier locates the payload with this id and checks that its
/// data equals `keccak256(scale_encode_beefy_mmr_leaf(latest_mmr_leaf))`.
pub const next_committee_payload_id = "nc"

/// The on-chain datum tracking the BEEFY consensus checkpoint.
/// `latest_height` is the most recent relay block whose commitment has
/// been verified; new proofs must strictly advance it.
/// `current_authority_set` and `next_authority_set` (with their stake
/// totals) define which validators may sign commitments and what total
/// stake they represent. When a proof carries a leaf whose next set has
/// advanced, the current set shifts to the old next set and the incoming
/// leaf's `next_authority_set` becomes the new next set.
/// `beefy_activation_block` is carried through unchanged on-chain and is
/// reserved for off-chain consumers (e.g. the relay indexer).
pub type BeefyConsensusState {
  latest_height: Int,
  beefy_activation_block: Int,
  current_authority_set: AuthoritySetCommitment,
  current_stake_total: Int,
  next_authority_set: AuthoritySetCommitment,
  next_stake_total: Int,
}

/// Stake threshold as a ratio. The required signed stake for a commitment
/// is computed from the total authority-set stake using this ratio with
/// the Substrate/BEEFY reference threshold semantics. Spending rules for
/// the threshold UTxO are defined by `beefy_validation` in
/// `validators/thresholds.ak`.
pub type BeefyThreshold {
  numerator: Int,
  denominator: Int,
}

/// A BEEFY authority leaf, as produced by the relay chain's
/// authority-set Merkle tree. Byte layout: bytes `0..32` are
/// `keccak256(compressed_secp256k1_pubkey)`; bytes `32..` are the
/// validator's stake encoded as a big-endian unsigned integer. The leaf
/// width varies with stake size; `find_auth_in_leaves` slices the hash
/// and stake directly at these offsets.
pub type Leaf =
  ByteArray

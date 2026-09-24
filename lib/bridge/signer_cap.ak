//// Test-only `signer_cap` measurement (spec §11): a committee of N
//// single-seat keys, its quorum update, and the transaction that carries it.

use bridge/types.{
  AuthoritySetCommitment, BeefyConsensusState, BeefyMmrLeaf, BridgeUpdate,
}

/// One generated committee: the quorum's signatures, the signers-only multiproof, and the MMR proof of the signed leaf.
pub type Cap {
  seat_count: Int,
  signatures: List<ByteArray>,
  multiproof: Data,
  keyset_root: ByteArray,
  parent_hash: ByteArray,
  mmr_root: ByteArray,
  mmr_proof: List<ByteArray>,
}

pub const block_number = 1_048_576

pub const set_id = 4

pub const next_id = 5

pub fn committee(cap: Cap, id: Int) -> AuthoritySetCommitment {
  AuthoritySetCommitment {
    validator_set_id: id,
    seat_count: cap.seat_count,
    keyset_commitment: cap.keyset_root,
  }
}

pub fn state_in(cap: Cap) -> BeefyConsensusState {
  BeefyConsensusState {
    latest_mmr_root: cap.parent_hash,
    latest_height: block_number - 1,
    beefy_activation_block: 1,
    current_committee: committee(cap, set_id),
    next_committee: committee(cap, next_id),
  }
}

pub fn state_out(cap: Cap) -> BeefyConsensusState {
  BeefyConsensusState {
    ..state_in(cap),
    latest_mmr_root: cap.mmr_root,
    latest_height: block_number,
  }
}

pub fn update(cap: Cap) -> BridgeUpdate {
  BridgeUpdate {
    mmr_root: cap.mmr_root,
    block_number,
    validator_set_id: set_id,
    signatures: cap.signatures,
    leaf: BeefyMmrLeaf {
      version: 0,
      parent_number: block_number - 1,
      parent_hash: cap.parent_hash,
      next_authority_set: committee(cap, next_id),
      extra: "",
    },
    mmr_proof: cap.mmr_proof,
    multiproof: cap.multiproof,
  }
}

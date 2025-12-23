pub type Vote {
  signature: ByteArray,
  authority_index: Int,
  public_key: ByteArray,
  vote_strength: Int,
}

pub type Payload {
  id: ByteArray,
  data: ByteArray,
}

pub type Commitment {
  payloads: List<Payload>,
  block_number: Int,
  validator_set_id: Int,
}

pub type SignedCommitment {
  commitment: Commitment,
  votes: List<Vote>,
}

pub type AuthoritySetCommitment {
  id: Int,
  len: Int,
  root: ByteArray,
}

pub type BeefyMmrLeaf {
  version: Int,
  parent_number: Int,
  parent_hash: ByteArray,
  next_authority_set: AuthoritySetCommitment,
  extra: ByteArray,
  k_index: Int,
  leaf_index: Int,
}

pub type ProofNodeRec =
  List<Data>

pub type RelayChainProof {
  signed_commitment: SignedCommitment,
  latest_mmr_leaf: BeefyMmrLeaf,
  proof: Data<ProofNodeRec>,
}

pub type BeefyConsensusProof {
  relay: RelayChainProof,
}

pub const next_committee_payload_id = "nc"

pub type BeefyConsensusState {
  latest_height: Int,
  beefy_activation_block: Int,
  current_authority_set: AuthoritySetCommitment,
  current_stake_total: Int,
  next_authority_set: AuthoritySetCommitment,
  next_stake_total: Int,
}

pub type BeefyThreshold {
  numerator: Int,
  denominator: Int,
}

pub type Leaf =
  ByteArray

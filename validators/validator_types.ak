use aiken/crypto.{VerificationKeyHash}
use bridge/merkle.{Peak}
use bridge/types.{
  BeefyConsensusState, BeefyMmrLeaf, ProofNodeRec, SignedCommitment,
} as bridge_types
use cnight_generates_dust.{DustAction, DustMappingDatum}
use multisig/types.{MultisigThreshold, NativeScriptSigner, Sr25519PubKey}
use upgradable/types.{TwoStageRedeemer, UpgradeState} as t

@list
pub type Multisig {
  total_signers: Int,
  signers: Pairs<NativeScriptSigner, Sr25519PubKey>,
}

validator z_threshold_types {
  spend(_datum: Option<MultisigThreshold>, _redeemer, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

validator z_permissioned_types {
  spend(
    _datum: Option<Multisig>,
    _redeemer: Pairs<VerificationKeyHash, Sr25519PubKey>,
    _output,
    _tx,
  ) {
    fail
  }

  else(_) {
    fail
  }
}

validator z_two_stage_upgrade_types {
  spend(_datum: Option<UpgradeState>, _redeemer: TwoStageRedeemer, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

pub type RelayChainProof {
  signed_commitment: SignedCommitment,
  latest_mmr_leaf: BeefyMmrLeaf,
  mmr_proof: List<Peak>,
  proof: ProofNodeRec,
}

validator z_committee_bridge_types {
  spend(
    _datum: Option<BeefyConsensusState>,
    _redeemer: RelayChainProof,
    _output,
    _tx,
  ) {
    fail
  }

  else(_) {
    fail
  }
}

validator z_generates_dust {
  spend(_datum: Option<DustMappingDatum>, _redeemer: DustAction, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

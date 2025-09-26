use aiken/crypto.{VerificationKeyHash}
use multisig/types.{Multisig, MultisigThreshold}
use upgradable/types.{TwoStageRedeemer, UpgradeState} as t

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
    _redeemer: List<VerificationKeyHash>,
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

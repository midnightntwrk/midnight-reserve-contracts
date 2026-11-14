use forever/types_v2.{FederatedOpsV2}
use night_staking.{DelegationLock, StakingAction}

validator z_federated_ops_v2_types {
  spend(_datum: Option<FederatedOpsV2>, _redeemer, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

validator z_night_staking_types {
  spend(_datum: Option<DelegationLock>, _redeemer: StakingAction, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

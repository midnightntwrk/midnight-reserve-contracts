use forever/types_v2.{FederatedOpsV2}
use logic/types_v2.{
  InitTokenAction, ReserveAction, ReserveRewardState, ReserveStagingParams,
} as logic_types
use night_staking.{DelegationLock, StakingAction}
use registration/types.{Node, RegistrationAction}

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

validator z_night_registration_types {
  spend(_datum: Option<Node>, _redeemer: RegistrationAction, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

validator z_reserve_v2_types {
  spend(
    _datum: Option<ReserveRewardState>,
    _redeemer: ReserveAction,
    _output,
    _tx,
  ) {
    fail
  }

  else(_) {
    fail
  }
}

validator z_reserve_staging_params_types {
  spend(_datum: Option<ReserveStagingParams>, _redeemer, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

validator z_reserve_v2_mint_types {
  spend(_datum: Option<Data>, _redeemer: InitTokenAction, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

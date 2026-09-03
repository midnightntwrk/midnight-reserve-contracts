use rewards/types.{
  AccountAction, AccountDatum, AccountGate, BatcherRedeemer, BatcherState,
  PoolRedeemer, ReleaseState,
}

validator z_rewards_types {
  spend(_datum: Option<AccountDatum>, _redeemer: AccountGate, _output, _tx) {
    fail
  }

  mint(_redeemer: AccountAction, _policy, _tx) {
    fail
  }

  withdraw(_redeemer: BatcherRedeemer, _account, _tx) {
    fail
  }

  publish(_redeemer: PoolRedeemer, _cert, _tx) {
    fail
  }

  vote(_redeemer: ReleaseState, _voter, _tx) {
    fail
  }

  propose(_redeemer: BatcherState, _proposal, _tx) {
    fail
  }
}

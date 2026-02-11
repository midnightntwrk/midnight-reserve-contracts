use cardano/assets.{PolicyId}

@list
pub type StagingState {
  cnight_test_policy: PolicyId,
  forever_script_hash: PolicyId,
}

/// Redeemer for v2 logic validators.
/// Normal: standard multisig-validated state change
/// Migrate: one-time datum upgrade from v1 to v2, bypasses multisig, gated by logic_round
pub type LogicRedeemer {
  Normal
  Migrate
}

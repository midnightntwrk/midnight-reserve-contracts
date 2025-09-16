use cardano/assets.{PolicyId}

pub type AuthorizerLogic {
  RefTechnicalAuthRefCouncil
  RefTechnicalAuthSpendCouncil
  SpendTechnicalAuthRefCouncil
}

pub type StagingState {
  cnight_test_policy: PolicyId,
  forever_script_hash: PolicyId,
}

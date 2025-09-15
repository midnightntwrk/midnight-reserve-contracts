use aiken/crypto.{ScriptHash}
use cardano/assets.{PolicyId}

pub type AuthorizerLogic {
  RefTechnicalAuth
  RefTechnicalAuthRefCouncil
  RefTechnicalAuthSpendCouncil
  SpendTechnicalAuth
  SpendTechnicalAuthRefCouncil
  SpendTechnicalAuthSpendCouncil
}

pub type StagingState {
  cnight_test_policy: PolicyId,
  technical_authority_nft: PolicyId,
  council_nft: PolicyId,
}

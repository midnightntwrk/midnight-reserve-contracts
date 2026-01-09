use aiken/crypto.{ScriptHash}
use cardano/transaction.{OutputReference}

@list
pub type UpgradeState {
  logic: ScriptHash,
  mitigation_logic: ScriptHash,
  auth: ScriptHash,
  mitigation_auth: ScriptHash,
  round: Int,
  logic_round: Int,
}

@list
pub type TwoStageRedeemer {
  update_field: UpdateField,
  which_stage: WhichStage,
}

pub type UpdateField {
  Logic
  Auth
  MitigationLogic
  MitigationAuth
}

pub type WhichStage {
  Main(OutputReference)
  Staging(OutputReference, ScriptHash)
}

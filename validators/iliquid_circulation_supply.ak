use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/forever_contract.{forever_contract}
use upgradable/two_stage_upgrade.{two_stage_upgradable}

fn ics_init_validation(_datum: Data, _redeemer: Redeemer) {
  // ics initialization validation
  // For properly setting up state
  todo
}

validator forever_ics {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    forever_contract(
      transaction,
      redeemer,
      info,
      one_shot_ref,
      config.ics_two_stage_hash,
      ics_init_validation,
    )
  }
}

validator two_stage_upgrade_ics {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

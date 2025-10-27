use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/script.{logic_merge} as logic_script
use upgradable/two_stage_upgrade.{two_stage_upgradable}

fn ics_init_validation(_datum: Data, _redeemer: Redeemer) {
  True
}

validator ics_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    forever_contract(
      ctx,
      one_shot_ref,
      config.ics_two_stage_hash,
      ics_init_validation,
    )
  }
}

validator ics_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator ics_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    logic_merge(transaction, info, config.ics_forever_hash)
  }
}

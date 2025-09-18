use aiken/builtin
use auth/script.{auth_multisig_validation} as auth_script
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/script.{logic_deposit} as logic_script
use upgradable/two_stage_upgrade.{two_stage_upgradable}

fn ics_init_validation(datum: Data, _redeemer: Redeemer) {
  builtin.un_i_data(datum) == 0
}

validator ics_forever {
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

validator ics_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

// ICS is currently a black hole until updated
validator ics_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, .. } = ctx

    logic_deposit(transaction)
  }
}

validator ics_gov {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    auth_multisig_validation(transaction, info)
  }
}

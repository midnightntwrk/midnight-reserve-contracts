use auth/script.{auth_multisig_validation} as auth_script
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/script.{logic_deposit} as logic_script
use upgradable/two_stage_upgrade.{two_stage_upgradable}

fn reserve_init_validation(_datum: Data, _redeemer: Redeemer) {
  // Reserve initialization validation
  // For properly setting up state
  // Figure out max release rate logic
  todo
}

validator reserve_forever {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.reserve_one_shot_hash,
        config.reserve_one_shot_index,
      )

    forever_contract(
      transaction,
      redeemer,
      info,
      one_shot_ref,
      config.reserve_two_stage_hash,
      reserve_init_validation,
    )
  }
}

validator reserve_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.reserve_one_shot_hash,
        config.reserve_one_shot_index,
      )

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator reserve_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, .. } = ctx

    logic_deposit(transaction)
  }
}

validator reserve_gov {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    auth_multisig_validation(transaction, info)
  }
}

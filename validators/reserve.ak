use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use config
use upgradable/two_stage_upgrade.{two_stage_upgradable}

validator forever_reserve {
  else(_ctx) {
    todo
  }
}

validator two_stage_upgrade_reserve {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let marker_check = redeemer |> builtin.serialise_data

    let one_shot_ref =
      OutputReference(config.one_shot_hash, config.one_shot_index)

    and {
      two_stage_upgradable(transaction, redeemer, info, one_shot_ref),
      // Makes this script unique to midnight
      marker_check != config.cnight_policy,
    }
  }
}

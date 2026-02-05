use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/next_version.{logic_merge_v2}
use logic/script.{logic_merge} as logic_script
use upgradable/two_stage_upgrade.{two_stage_upgradable}

/// No-op validation for ICS initialization; all checks are handled by the forever helper.
fn ics_init_validation(_datum: Data, _redeemer: Redeemer) {
  True
}

/// One-shot minting for immutable ICS NFT state.
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

/// Staged upgrades for ICS contract.
validator ics_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

/// Handles ICS withdrawal operations.
validator ics_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    logic_merge(transaction, info, config.ics_forever_hash)
  }
}

/// Handles ICS withdrawal operations (v2).
validator ics_logic_v2 {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    let one_shot_ref =
      OutputReference(
        config.ics_logic_v2_one_shot_hash,
        config.ics_logic_v2_one_shot_index,
      )
    logic_merge_v2(
      transaction,
      info,
      config.ics_forever_hash,
      config.ics_two_stage_hash,
      one_shot_ref,
    )
  }
}

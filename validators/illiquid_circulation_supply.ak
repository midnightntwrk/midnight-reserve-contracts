use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/script.{logic_merge} as logic_script
use upgradable/two_stage_upgrade.{two_stage_upgradable}

/// No-op validation for ICS initialization; all checks are handled by the forever helper.
fn ics_init_validation(_datum: Data, _redeemer: Redeemer) {
  True
}

/// ICS forever validator: mints and manages the immutable illiquid circulation supply NFT state.
/// Uses one-shot minting pattern and delegates to the forever contract helper.
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

/// ICS two-stage upgrade validator: manages staged upgrades for the ICS contract.
/// Delegates to the shared two-stage upgrade helper for minting and spending validation.
validator ics_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

/// ICS logic validator: handles ICS withdrawal operations.
/// Delegates to the logic merge helper using the ICS forever script hash.
validator ics_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    logic_merge(transaction, info, config.ics_forever_hash)
  }
}

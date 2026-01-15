use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/script.{logic_merge} as logic_script
use upgradable/two_stage_upgrade.{two_stage_upgradable}

/// No-op validation for reserve initialization; all checks are handled by the forever helper.
fn reserve_init_validation(_datum: Data, _redeemer: Redeemer) {
  True
}

/// Reserve forever validator: mints and manages the immutable reserve NFT state.
/// Uses one-shot minting pattern and delegates to the forever contract helper.
validator reserve_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.reserve_one_shot_hash,
        config.reserve_one_shot_index,
      )

    forever_contract(
      ctx,
      one_shot_ref,
      config.reserve_two_stage_hash,
      reserve_init_validation,
    )
  }
}

/// Reserve two-stage upgrade validator: manages staged upgrades for the reserve contract.
/// Delegates to the shared two-stage upgrade helper for minting and spending validation.
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

/// Reserve logic validator: handles reserve withdrawal operations.
/// Delegates to the logic merge helper using the reserve forever script hash.
validator reserve_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    logic_merge(transaction, info, config.reserve_forever_hash)
  }
}

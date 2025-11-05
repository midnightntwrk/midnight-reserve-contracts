use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/script.{logic_merge} as logic_script
use upgradable/two_stage_upgrade.{two_stage_upgradable}

fn ics_init_validation(_datum: Data, _redeemer: Redeemer) {
  // (ICS-1) Iliquid supply bootstrap relies solely on the forever helper.
  True
}

validator ics_forever {
  else(ctx: ScriptContext) {
    // (IF-1) Rebuild the iliq one-shot reference consumed during forever minting.
    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    // (IF-2) Delegate minting and operational checks to the forever helper.
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

    // (IU-1) Rebuild the iliq one-shot reference consumed during staging minting.
    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    // (IU-2) Delegate two-stage setup and upgrade checks to the shared helper.
    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator ics_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    // (IL-1) Apply the shared logic merge helper using the iliq forever script hash.
    logic_merge(transaction, info, config.ics_forever_hash)
  }
}

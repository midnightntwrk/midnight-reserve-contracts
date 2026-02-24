use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use config
use logic/next_version.{logic_merge_v2}

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

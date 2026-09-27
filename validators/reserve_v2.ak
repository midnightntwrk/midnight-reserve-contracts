use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use config
use rewards/release.{reserve_logic}

/// Reserve logic v2: merge, and the timed release into the rewards pool (docs/rewards/spec.md §8).
validator reserve_logic_v2 {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    reserve_logic(
      transaction,
      info,
      redeemer,
      config.reserve_two_stage_hash,
      OutputReference(
        config.reserve_logic_v2_one_shot_hash,
        config.reserve_logic_v2_one_shot_index,
      ),
    )
  }
}

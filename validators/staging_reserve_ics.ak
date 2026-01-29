use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{staging_forever_contract}
use logic/script.{logic_merge} as logic_script

/// No-op validation for reserve initialization; all checks are handled by the forever helper.
fn reserve_init_validation(_datum: Data, _redeemer: Redeemer) {
  True
}

/// No-op validation for ICS initialization; all checks are handled by the forever helper.
fn ics_init_validation(_datum: Data, _redeemer: Redeemer) {
  True
}

// =============================================================================
// RESERVE STAGING TRACK
// =============================================================================

/// Staging forever for reserve - HARDCODED to read from staging NFT.
validator reserve_staging_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.reserve_one_shot_hash,
        config.reserve_one_shot_index,
      )

    staging_forever_contract(
      ctx,
      one_shot_ref,
      config.reserve_two_stage_hash,
      reserve_init_validation,
    )
  }
}

/// Staging logic for reserve - references staging forever hash.
validator reserve_staging_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    logic_merge(transaction, info, config.reserve_staging_forever_hash)
  }
}

// =============================================================================
// ICS STAGING TRACK
// =============================================================================

/// Staging forever for ICS - HARDCODED to read from staging NFT.
validator ics_staging_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(config.ics_one_shot_hash, config.ics_one_shot_index)

    staging_forever_contract(
      ctx,
      one_shot_ref,
      config.ics_two_stage_hash,
      ics_init_validation,
    )
  }
}

/// Staging logic for ICS - references staging forever hash.
validator ics_staging_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    logic_merge(transaction, info, config.ics_staging_forever_hash)
  }
}

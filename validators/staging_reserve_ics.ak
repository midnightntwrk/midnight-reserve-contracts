use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/staging.{staging_forever_contract}

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
        config.reserve_staging_one_shot_hash,
        config.reserve_staging_one_shot_index,
      )

    staging_forever_contract(
      ctx,
      one_shot_ref,
      config.reserve_two_stage_hash,
      reserve_init_validation,
    )
  }
}

// =============================================================================
// ICS STAGING TRACK
// =============================================================================

/// Staging forever for ICS - HARDCODED to read from staging NFT.
validator ics_staging_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.ics_staging_one_shot_hash,
        config.ics_staging_one_shot_index,
      )

    staging_forever_contract(
      ctx,
      one_shot_ref,
      config.ics_two_stage_hash,
      ics_init_validation,
    )
  }
}

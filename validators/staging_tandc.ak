use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use config
use forever/staging.{staging_forever_contract}
use forever/types.{TermsAndConditions, Versioned}

/// Validates that the datum is a well-formed versioned TermsAndConditions at logic round 0,
/// with a 32-byte hash.
fn validate_terms_structure(datum: Data, _redeemer) {
  expect Versioned { data: TermsAndConditions { hash, .. }, logic_round: 0 }: Versioned<
    TermsAndConditions,
  > = datum

  builtin.length_of_bytearray(hash) == 32
}

// =============================================================================
// TERMS AND CONDITIONS STAGING TRACK
// =============================================================================

/// Staging forever for T&C - HARDCODED to read from staging NFT.
validator terms_and_conditions_staging_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.terms_and_conditions_staging_one_shot_hash,
        config.terms_and_conditions_staging_one_shot_index,
      )

    staging_forever_contract(
      ctx,
      one_shot_ref,
      config.terms_and_conditions_two_stage_hash,
      validate_terms_structure,
    )
  }
}

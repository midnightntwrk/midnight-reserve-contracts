use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use config
use forever/types.{TermsAndConditions, Versioned}
use logic/next_version.{logic_multisig_validation_nft_input_v2}

/// Validates that the datum is a well-formed versioned TermsAndConditions at logic round 1,
/// with a 32-byte hash.
fn validate_terms_structure_v2(datum: Data, _redeemer) {
  expect Versioned { data: TermsAndConditions { hash, .. }, logic_round: 1 }: Versioned<
    TermsAndConditions,
  > = datum

  builtin.length_of_bytearray(hash) == 32
}

/// Validates migration from v1 (logic_round: 0) to v2 (logic_round: 1).
/// Ensures T&C data is unchanged and hash is 32 bytes.
fn migrate_validation(output_datum: Data, input_datum: Data) {
  expect Versioned { data: input_tc, logic_round: 0 }: Versioned<
    TermsAndConditions,
  > = input_datum
  expect Versioned { data: output_tc, logic_round: 1 }: Versioned<
    TermsAndConditions,
  > = output_datum

  and {
    output_tc == input_tc,
    builtin.length_of_bytearray(output_tc.hash) == 32,
  }
}

/// Enforces multisig quorum for T&C updates via withdrawal (v2).
validator terms_and_conditions_logic_v2 {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    let one_shot_ref =
      OutputReference(
        config.terms_and_conditions_logic_v2_one_shot_hash,
        config.terms_and_conditions_logic_v2_one_shot_index,
      )

    logic_multisig_validation_nft_input_v2(
      transaction,
      redeemer,
      info,
      config.terms_and_conditions_forever_hash,
      config.terms_and_conditions_two_stage_hash,
      validate_terms_structure_v2,
      migrate_validation,
      config.terms_and_conditions_threshold_hash,
      one_shot_ref,
    )
  }
}

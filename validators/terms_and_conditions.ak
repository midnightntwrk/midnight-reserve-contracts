use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use config
use forever/script.{forever_contract} as ft
use forever/types.{TermsAndConditions, Versioned}
use logic/script.{logic_multisig_validation_nft_input}
use upgradable/two_stage_upgrade.{two_stage_upgradable}

/// Validates that the datum is a well-formed versioned TermsAndConditions at logic round 0,
/// with a 32-byte hash.
fn validate_terms_structure(datum: Data, _redeemer) {
  expect Versioned { data: TermsAndConditions { hash, .. }, logic_round: 0 }: Versioned<
    TermsAndConditions,
  > = datum

  builtin.length_of_bytearray(hash) == 32
}

/// Terms and conditions forever validator: mints and manages the immutable T&C NFT state.
/// Uses one-shot minting pattern and delegates to the forever contract helper.
validator terms_and_conditions_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.terms_and_conditions_one_shot_hash,
        config.terms_and_conditions_one_shot_index,
      )

    forever_contract(
      ctx,
      one_shot_ref,
      config.terms_and_conditions_two_stage_hash,
      validate_terms_structure,
    )
  }
}

/// Terms and conditions two-stage upgrade validator: manages staged upgrades for the T&C contract.
/// Delegates to the shared two-stage upgrade helper for minting and spending validation.
validator terms_and_conditions_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.terms_and_conditions_one_shot_hash,
        config.terms_and_conditions_one_shot_index,
      )

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

/// Terms and conditions logic validator: enforces multisig quorum requirements for T&C updates.
/// Validates via withdrawal and allows stake credential registration.
validator terms_and_conditions_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.terms_and_conditions_forever_hash,
      validate_terms_structure,
      config.terms_and_conditions_threshold_hash,
    )
  }
}

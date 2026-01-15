use aiken/collection/dict.{to_pairs}
use cardano/address.{Script}
use cardano/assets.{to_dict}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use multisig/script.{check_for_multisig, threshold_validation}
use multisig/types.{MultisigThreshold}
use utils.{input_linked_mint, must_find}

/// Validates that the datum is a well-formed MultisigThreshold with valid fractions:
/// numerators must be non-negative and less than their corresponding denominators.
fn validation(datum: Data) {
  expect MultisigThreshold {
    technical_auth_numerator,
    technical_auth_denominator,
    council_numerator,
    council_denominator,
  }: MultisigThreshold = datum

  and {
    technical_auth_numerator < technical_auth_denominator,
    council_numerator < council_denominator,
    technical_auth_numerator > -1,
    council_numerator > -1,
  }
}

/// Main governance threshold validator: handles minting and spending of the main gov threshold NFT.
/// On minting: validates one-shot spend and datum structure.
/// On spending: requires tech auth and council multisig authorization, preserves NFT identity,
/// and validates replacement datum.
validator main_gov_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let Transaction { inputs, reference_inputs, outputs, mint, .. } =
      transaction

    let one_shot_ref =
      OutputReference(
        config.main_gov_one_shot_hash,
        config.main_gov_one_shot_index,
      )

    when info is {
      Minting(own_policy) -> {
        let datum =
          input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

        validation(datum)
      }

      Spending { output, .. } -> {
        let own_input =
          must_find(
            inputs,
            fn(input: Input) { input.output_reference == output },
          )

        let Input {
          output: Output { address, value, datum: spending_datum, .. },
          ..
        } = own_input

        expect Script(own_hash) as pay_cred = address.payment_credential

        let expected_nft_id = [Pair(own_hash, [Pair("", 1)])]

        expect [_, ..nft_id] = value |> to_dict |> to_pairs

        expect as_data(expected_nft_id) == as_data(nft_id)

        expect InlineDatum(spending_datum) = spending_datum

        expect MultisigThreshold {
          technical_auth_numerator,
          technical_auth_denominator,
          council_numerator,
          council_denominator,
        }: MultisigThreshold = spending_datum

        expect and {
            check_for_multisig(
              reference_inputs,
              mint,
              config.technical_authority_forever_hash,
              technical_auth_numerator,
              technical_auth_denominator,
            ),
            check_for_multisig(
              reference_inputs,
              mint,
              config.council_forever_hash,
              council_numerator,
              council_denominator,
            ),
          }

        expect [
          Output { address: out_addr, value: out_value, datum: out_datum, .. },
          ..
        ] = outputs

        expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

        expect InlineDatum(out_datum) = out_datum

        and {
          out_addr.payment_credential == pay_cred,
          nft_id == out_nft_id,
          validation(out_datum),
        }
      }

      _ -> fail
    }
  }
}

/// Threshold NFT for staging governance operations.
validator staging_gov_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.staging_gov_one_shot_hash,
        config.staging_gov_one_shot_index,
      )

    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

/// Threshold NFT for council membership changes.
validator main_council_update_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.main_council_update_one_shot_hash,
        config.main_council_update_one_shot_index,
      )

    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

/// Threshold NFT for tech auth membership changes.
validator main_tech_auth_update_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.main_tech_auth_update_one_shot_hash,
        config.main_tech_auth_update_one_shot_index,
      )

    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

/// Threshold NFT for federated ops membership changes.
validator main_federated_ops_update_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.main_federated_ops_update_one_shot_hash,
        config.main_federated_ops_update_one_shot_index,
      )

    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

/// Threshold NFT for BEEFY protocol signer requirements.
validator beefy_signer_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.committee_threshold_one_shot_hash,
        config.committee_threshold_one_shot_index,
      )

    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

/// Threshold NFT for T&C updates.
validator terms_and_conditions_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.terms_and_conditions_threshold_one_shot_hash,
        config.terms_and_conditions_threshold_one_shot_index,
      )

    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

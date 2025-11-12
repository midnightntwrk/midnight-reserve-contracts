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

fn validation(datum: Data) {
  // (THD-1) Decode the candidate datum into a multisig threshold record.
  expect MultisigThreshold {
    technical_auth_numerator,
    technical_auth_denominator,
    council_numerator,
    council_denominator,
  }: MultisigThreshold = datum

  and {
    // (THD-2) Require the technical-authority numerator to be below its denominator.
    technical_auth_numerator < technical_auth_denominator,
    // (THD-3) Require the council numerator to be below its denominator.
    council_numerator < council_denominator,
    // (THD-4) Require the technical-authority numerator to be strictly positive.
    technical_auth_numerator > -1,
    // (THD-5) Require the council numerator to be strictly positive.
    council_numerator > -1,
  }
}

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
        // (THM-1) Capture the minted inline datum while validating the one-shot spend.
        let datum =
          input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

        // (THM-2) Enforce the minted datum to decode into `MultisigThreshold`.
        expect MultisigThreshold {
          technical_auth_numerator,
          technical_auth_denominator,
          council_numerator,
          council_denominator,
        }: MultisigThreshold = datum

        and {
          // (THM-3) Touch `cnight_policy` so the mint branch remains in the script hash.
          own_policy != config.cnight_policy,
          // (THM-4) Require the technical-authority fraction to be less than one.
          technical_auth_numerator < technical_auth_denominator,
          // (THM-5) Require the council fraction to be less than one.
          council_numerator < council_denominator,
        }
      }

      Spending { output, .. } -> {
        // (THS-1) Locate the script input selected by the ledger.
        let own_input =
          must_find(
            inputs,
            fn(input: Input) { input.output_reference == output },
          )

        let Input {
          output: Output { address, value, datum: spending_datum, .. },
          ..
        } = own_input

        // (THS-2) Ensure the consumed input is guarded by this validator.
        expect Script(own_hash) as pay_cred = address.payment_credential

        // (THS-3) Rebuild the canonical NFT identity for later comparisons.
        let expected_nft_id = [Pair(own_hash, [Pair("", 1)])]

        // (THS-4) Record the NFT pair present on the spending input.
        expect [_, ..nft_id] = value |> to_dict |> to_pairs

        // (THS-5) Require the NFT pair to match the script identity exactly.
        expect as_data(expected_nft_id) == as_data(nft_id)

        // (THS-6) Demand the spending datum be provided inline.
        expect InlineDatum(spending_datum) = spending_datum

        // (THS-7) Decode the inline datum into `MultisigThreshold`.
        expect MultisigThreshold {
          technical_auth_numerator,
          technical_auth_denominator,
          council_numerator,
          council_denominator,
        }: MultisigThreshold = spending_datum

        // (THS-8) Require the technical-authority native script derived from the datum and threshold to appear in the mint field.
        expect and {
            check_for_multisig(
              reference_inputs,
              mint,
              config.technical_authority_forever_hash,
              technical_auth_numerator,
              technical_auth_denominator,
            ),
            // (THS-9) Require the council native script derived from the datum and threshold to appear in the mint field.
            check_for_multisig(
              reference_inputs,
              mint,
              config.council_forever_hash,
              council_numerator,
              council_denominator,
            ),
          }

        // (THS-10) Fetch the first replacement output for validation.
        expect [
          Output { address: out_addr, value: out_value, datum: out_datum, .. },
          ..
        ] = outputs

        // (THS-11) Record the NFT pair emitted by the replacement output.
        expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

        // (THS-12) Ensure the replacement datum remains inline.
        expect InlineDatum(out_datum) = out_datum

        and {
          // (THS-13) Preserve the script credential across the spend.
          out_addr.payment_credential == pay_cred,
          // (THS-14) Preserve the NFT pair across the spend.
          nft_id == out_nft_id,
          // (THS-15) Validate the replacement datum content.
          validation(out_datum),
        }
      }

      _ -> fail
    }
  }
}

validator staging_gov_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.staging_gov_one_shot_hash,
        config.staging_gov_one_shot_index,
      )

    // (SGT-1) Delegate validation to the shared threshold helper (`threshold_validation`).
    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

validator main_council_update_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.main_council_update_one_shot_hash,
        config.main_council_update_one_shot_index,
      )

    // (CGT-1) Delegate validation to the shared threshold helper (`threshold_validation`).
    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

validator main_tech_auth_update_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.main_tech_auth_update_one_shot_hash,
        config.main_tech_auth_update_one_shot_index,
      )

    // (TAT-1) Delegate validation to the shared threshold helper (`threshold_validation`).
    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

validator main_federated_ops_update_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.main_federated_ops_update_one_shot_hash,
        config.main_federated_ops_update_one_shot_index,
      )

    // (FOT-1) Delegate validation to the shared threshold helper (`threshold_validation`).
    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

validator beefy_signer_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let one_shot_ref =
      OutputReference(
        config.committee_threshold_one_shot_hash,
        config.committee_threshold_one_shot_index,
      )

    // (BST-1) Delegate validation to the shared threshold helper (`threshold_validation`).
    threshold_validation(transaction, info, one_shot_ref, validation)
  }
}

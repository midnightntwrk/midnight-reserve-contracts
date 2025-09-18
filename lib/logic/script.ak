use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/assets.{to_dict}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{Input, OutputReference, Redeemer, Transaction}
use config
use logic/types.{
  AuthorizerLogic, RefTechnicalAuthRefCouncil, RefTechnicalAuthSpendCouncil,
  SpendTechnicalAuthRefCouncil, StagingState,
}
use multisig/script.{check_for_multisig}
use multisig/types.{MainMultisigThreshold, StagingMultisigThreshold} as t
use upgradable/two_stage_upgrade.{logic_is_on_main}
use utils.{
  get_input_state_by_policy, get_output_state_by_policy, must_find,
  one_shot_mint,
}

pub fn logic_deposit(transaction: Transaction) {
  todo
}

pub fn logic_multisig_validation_nft_input(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  one_shot_ref: OutputReference,
  logic_state_validation,
  spending_type: AuthorizerLogic,
  main_threshold: ScriptHash,
  staging_threshold: ScriptHash,
) {
  let Transaction { inputs, reference_inputs, outputs, mint, .. } = transaction

  let validation =
    fn(own_hash) {
      if logic_is_on_main(
        reference_inputs,
        config.council_two_stage_hash,
        own_hash,
      ) {
        let tech_auth_location, council_location <-
          fn(callback) {
            when spending_type is {
              RefTechnicalAuthRefCouncil ->
                callback(reference_inputs, reference_inputs)
              RefTechnicalAuthSpendCouncil -> callback(reference_inputs, inputs)
              SpendTechnicalAuthRefCouncil -> callback(inputs, reference_inputs)
            }
          }

        let main_threshold_datum =
          get_input_state_by_policy(reference_inputs, main_threshold)

        expect MainMultisigThreshold {
          technical_auth_numerator,
          technical_auth_denominator,
          council_numerator,
          council_denominator,
        } = main_threshold_datum

        let datum =
          get_output_state_by_policy(outputs, config.council_forever_hash)

        and {
          check_for_multisig(
            tech_auth_location,
            mint,
            config.technical_authority_forever_hash,
            technical_auth_numerator,
            technical_auth_denominator,
          ),
          check_for_multisig(
            council_location,
            mint,
            config.council_forever_hash,
            council_numerator,
            council_denominator,
          ),
          logic_state_validation(datum, redeemer),
        }
      } else {
        let datum = get_input_state_by_policy(inputs, own_hash)

        expect StagingState { forever_script_hash, .. }: StagingState = datum

        let staging_threshold_datum =
          get_input_state_by_policy(reference_inputs, staging_threshold)

        expect StagingMultisigThreshold {
          technical_auth_numerator,
          technical_auth_denominator,
        }: StagingMultisigThreshold = staging_threshold_datum

        expect
          check_for_multisig(
            reference_inputs,
            mint,
            config.technical_authority_forever_hash,
            technical_auth_numerator,
            technical_auth_denominator,
          )

        let datum = get_output_state_by_policy(outputs, forever_script_hash)

        logic_state_validation(datum, redeemer)
      }
    }

  when info is {
    Minting(own_policy) -> {
      let datum = one_shot_mint(inputs, mint, outputs, own_policy, one_shot_ref)

      expect StagingState { cnight_test_policy, forever_script_hash } = datum

      and {
        own_policy != config.cnight_policy,
        builtin.length_of_bytearray(cnight_test_policy) == 28,
        builtin.length_of_bytearray(forever_script_hash) == 28,
      }
    }

    Withdrawing(Script(own_hash)) |
    Publishing {
      certificate: UnregisterCredential { credential: Script(own_hash), .. },
      ..
    } -> validation(own_hash)

    Publishing { certificate: RegisterCredential { .. }, .. } -> True

    _ -> fail
  }
}

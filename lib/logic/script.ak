use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
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
use upgradable/two_stage_upgrade.{logic_is_on_main}
use utils.{get_input_state_by_policy, get_output_state_by_policy, must_find}

pub fn logic_multisig_validation_nft_input(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  one_shot_ref: OutputReference,
  logic_state_validation,
  spending_type: AuthorizerLogic,
) {
  let Transaction { inputs, reference_inputs, outputs, mint, .. } = transaction

  let validation =
    fn(own_hash) {
      let tech_auth_location, council_location <-
        fn(callback) {
          when spending_type is {
            RefTechnicalAuthRefCouncil ->
              callback(reference_inputs, reference_inputs)
            RefTechnicalAuthSpendCouncil -> callback(reference_inputs, inputs)
            SpendTechnicalAuthRefCouncil -> callback(inputs, reference_inputs)
          }
        }

      if logic_is_on_main(
        reference_inputs,
        config.council_two_stage_hash,
        own_hash,
      ) {
        let datum =
          get_output_state_by_policy(outputs, config.council_forever_hash)

        and {
          check_for_multisig(
            tech_auth_location,
            mint,
            config.technical_authority_forever_hash,
          ),
          check_for_multisig(
            council_location,
            mint,
            config.council_forever_hash,
          ),
          logic_state_validation(datum, redeemer),
        }
      } else {
        let datum = get_input_state_by_policy(inputs, own_hash)

        expect StagingState { forever_script_hash, .. }: StagingState = datum

        expect
          check_for_multisig(
            reference_inputs,
            mint,
            config.technical_authority_forever_hash,
          )

        let datum = get_output_state_by_policy(outputs, forever_script_hash)

        logic_state_validation(datum, redeemer)
      }
    }

  when info is {
    Minting(own_policy) -> {
      // Spend a determined input so minting can only happen once
      expect
        list.any(
          inputs,
          fn(input: Input) { input.output_reference == one_shot_ref },
        )

      let Pair(_, tokens) =
        mint
          |> to_dict
          |> to_pairs
          |> must_find(fn(value) { value.1st == own_policy })

      expect [Pair("", 1)] = tokens |> to_pairs

      let datum = get_output_state_by_policy(outputs, own_policy)

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

use aiken/builtin
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Script}
use cardano/assets
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{Input, OutputReference, Redeemer, Transaction}
use config
use logic/types.{StagingState}
use multisig/script.{check_for_multisig}
use multisig/types.{MainMultisigThreshold, StagingMultisigThreshold} as t
use upgradable/two_stage_upgrade.{logic_is_on_main}
use utils.{
  get_input_state_by_policy, get_output_state_by_policy, must_find,
  one_shot_mint,
}

pub fn logic_merge(
  transaction: Transaction,
  info: ScriptInfo,
  main_forever_script_hash: ScriptHash,
  one_shot_ref: OutputReference,
) {
  let Transaction { inputs, reference_inputs, outputs, mint, .. } = transaction

  let merge_values =
    fn(forever_script_hash) {
      let guarded_cred = Script(forever_script_hash)
      let guarded_value =
        list.foldr(
          inputs,
          assets.zero,
          fn(input, acc) {
            let output = input.output
            if output.address.payment_credential == guarded_cred {
              assets.merge(output.value, acc)
            } else {
              acc
            }
          },
        )

      let guarded_address = Address(Script(forever_script_hash), None)

      let output =
        must_find(outputs, fn(output) { output.address == guarded_address })

      and {
        output.value == guarded_value,
        builtin.length_of_bytearray(builtin.serialise_data(output.value)) < 2048,
      }
    }

  let validation =
    fn(own_hash) {
      if logic_is_on_main(
        reference_inputs,
        config.council_two_stage_hash,
        own_hash,
      ) {
        merge_values(main_forever_script_hash)
      } else {
        let datum = get_input_state_by_policy(inputs, own_hash)

        expect StagingState { forever_script_hash, .. }: StagingState = datum

        merge_values(forever_script_hash)
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

pub fn logic_multisig_validation_nft_input(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  one_shot_ref: OutputReference,
  main_forever_script_hash: ScriptHash,
  logic_state_validation,
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
        let main_threshold_datum =
          get_input_state_by_policy(reference_inputs, main_threshold)

        expect MainMultisigThreshold {
          technical_auth_numerator,
          technical_auth_denominator,
          council_numerator,
          council_denominator,
        } = main_threshold_datum

        let datum = get_output_state_by_policy(outputs, own_hash)

        and {
          check_for_multisig(
            // Used in the case we are spending multisig state rather than referencing it
            if main_forever_script_hash == config.technical_authority_forever_hash {
              inputs
            } else {
              reference_inputs
            },
            mint,
            config.technical_authority_forever_hash,
            technical_auth_numerator,
            technical_auth_denominator,
          ),
          check_for_multisig(
            // Used in the case we are spending multisig state rather than referencing it
            if main_forever_script_hash == config.council_forever_hash {
              inputs
            } else {
              reference_inputs
            },
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

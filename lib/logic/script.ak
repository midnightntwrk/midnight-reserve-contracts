use aiken/builtin
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Script}
use cardano/assets
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{Input, Redeemer, Transaction}
use config
use multisig/script.{check_for_multisig}
use multisig/types.{MultisigThreshold} as t
use utils.{get_input_state_by_policy, get_output_state_by_policy, must_find}

pub fn logic_merge(
  transaction: Transaction,
  info: ScriptInfo,
  main_forever_script_hash: ScriptHash,
) {
  let Transaction { inputs, outputs, .. } = transaction

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

  when info is {
    Withdrawing(_) | Publishing { certificate: UnregisterCredential { .. }, .. } ->
      merge_values(main_forever_script_hash)

    Publishing { certificate: RegisterCredential { .. }, .. } -> True

    _ -> fail
  }
}

pub fn logic_multisig_validation_nft_input(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  main_forever_script_hash: ScriptHash,
  logic_state_validation,
  main_threshold: ScriptHash,
) {
  let Transaction { inputs, reference_inputs, outputs, mint, .. } = transaction

  let validation =
    fn() {
      let threshold_datum =
        get_input_state_by_policy(reference_inputs, main_threshold)

      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      } = threshold_datum

      let datum = get_output_state_by_policy(outputs, main_forever_script_hash)

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
    }

  when info is {
    Withdrawing(_) | Publishing { certificate: UnregisterCredential { .. }, .. } ->
      validation()

    Publishing { certificate: RegisterCredential { .. }, .. } -> True

    _ -> fail
  }
}

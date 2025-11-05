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
              // (LM-1) Accumulate every input locked by the forever script.
              assets.merge(output.value, acc)
            } else {
              acc
            }
          },
        )

      let guarded_address = Address(Script(forever_script_hash), None)

      // (LM-0) Require the transaction to create an output for the forever address.
      let output =
        must_find(outputs, fn(output) { output.address == guarded_address })

      and {
        // (LM-2) Require the transaction to return the merged balance to the forever address.
        output.value == guarded_value,
        // (LM-3) Cap the merged output at 2048 bytes (half the ledger size limit).
        builtin.length_of_bytearray(builtin.serialise_data(output.value)) < 2048,
      }
    }

  when info is {
    Withdrawing(_) -> merge_values(main_forever_script_hash)

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
      // (ML-0) Fetch the threshold state referenced by `main_threshold`.
      let threshold_datum =
        get_input_state_by_policy(reference_inputs, main_threshold)

      // (ML-1) Decode the threshold datum to recover the configured fractions.
      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      } = threshold_datum

      // (ML-2) Require the transaction to preserve the forever state at the script address.
      let datum = get_output_state_by_policy(outputs, main_forever_script_hash)

      and {
        // (ML-3) Ensure the technical-authority native script built from the datum and threshold appears in the mint field.
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
        // (ML-4) Ensure the council native script built from the datum and threshold appears in the mint field.
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
        // (ML-5) Enforce the multisig signer constraints defined by MS-1, MS-2, MS-3, and MS-4.
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

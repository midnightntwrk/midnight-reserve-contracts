use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Script}
use cardano/assets.{ada_asset_name, ada_policy_id, to_dict}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{DatumHash, Input, Output, Redeemer, Transaction}
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
            let Output { address, value, .. } = input.output
            if address.payment_credential == guarded_cred {
              // (LM-3) Forbid consuming the forever NFT (policy `main_forever_script_hash`, name "")
              // while computing the merged value for this transaction.
              expect
                assets.quantity_of(value, main_forever_script_hash, "") == 0

              // (LM-1) Accumulate every input locked by the forever script.
              assets.merge(value, acc)
            } else {
              acc
            }
          },
        )

      let guarded_address = Address(Script(forever_script_hash), None)

      // (LM-0) Require the transaction to create an output locked by the forever script credential.
      let Output { value, datum, .. } =
        must_find(outputs, fn(output) { output.address == guarded_address })

      expect [Pair("", ada_tokens),
        Pair(cnight_policy, cnight_tokens)] = value |> to_dict |> to_pairs

      expect [Pair(_, ada_amount)] = ada_tokens |> to_pairs

      expect [Pair(cnight_name, cnight_amount)] = cnight_tokens |> to_pairs

      and {
        // (LM-2) Reject datum hashes so the replacement state remains inline and readable.
        when datum is {
          DatumHash(_) -> False
          _ -> True
        },
        // (LM-4) Enforce that the replacement output returns at least the accumulated ADA and NIGHT balances.
        config.cnight_policy == cnight_policy,
        cnight_name == "NIGHT",
        assets.quantity_of(guarded_value, ada_policy_id, ada_asset_name) <= ada_amount,
        assets.quantity_of(guarded_value, cnight_policy, cnight_name) <= cnight_amount,
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

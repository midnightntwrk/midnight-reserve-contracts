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

/// Reserve logic for merging multiple UTxOs at the forever address.
/// Accumulates all inputs locked by the forever script (except the state NFT),
/// then validates that the output returns at least the total ADA and CNIGHT balance.
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
              // Don't allow the forever NFT to be consumed during merge
              expect
                assets.quantity_of(value, main_forever_script_hash, "") == 0

              assets.merge(value, acc)
            } else {
              acc
            }
          },
        )

      let guarded_address = Address(Script(forever_script_hash), None)

      let Output { value, datum, .. } =
        must_find(outputs, fn(output) { output.address == guarded_address })

      expect [Pair("", ada_tokens),
        Pair(cnight_policy, cnight_tokens)] = value |> to_dict |> to_pairs

      expect [Pair(_, ada_amount)] = ada_tokens |> to_pairs

      expect [Pair(cnight_name, cnight_amount)] = cnight_tokens |> to_pairs

      and {
        // Datum must be inline (not hash) so state remains readable
        when datum is {
          DatumHash(_) -> False
          _ -> True
        },
        // Output must return at least the accumulated ADA and CNIGHT balances
        config.cnight_policy == cnight_policy,
        cnight_name == config.cnight_name,
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

/// Multisig validation logic for governance operations.
/// Requires both tech auth and council multisig approval (via native script minting),
/// then validates the state update via the provided validation function.
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

      // Forever state must be preserved at the script address
      let datum = get_output_state_by_policy(outputs, main_forever_script_hash)

      and {
        // Tech auth multisig must approve via native script minting
        check_for_multisig(
          // Use inputs if spending this multisig, otherwise use reference inputs
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
        // Council multisig must approve via native script minting
        check_for_multisig(
          // Use inputs if spending this multisig, otherwise use reference inputs
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

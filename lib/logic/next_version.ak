use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Script}
use cardano/assets.{ada_asset_name, ada_policy_id, to_dict}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{
  DatumHash, Output, OutputReference, Redeemer, Transaction,
}
use config
use logic/types.{StagingState}
use logic/types_v2.{LogicRedeemer, Migrate, Normal}
use multisig/script.{check_for_multisig}
use multisig/types.{MultisigThreshold} as t
use upgradable/two_stage_upgrade.{logic_is_on_main}
use utils.{
  get_input_state_by_policy, get_output_state_by_policy, input_linked_mint,
  must_find,
}

/// V2 reserve logic merge: parameterized two-stage hash, one-shot minting.
pub fn logic_merge_v2(
  transaction: Transaction,
  info: ScriptInfo,
  main_forever_script_hash: ScriptHash,
  two_stage_hash: ScriptHash,
  one_shot_ref: OutputReference,
) {
  let Transaction { inputs, reference_inputs, outputs, mint, .. } = transaction

  let merge_values =
    fn(forever_script_hash, cnight_policy_param) {
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
        cnight_policy_param == cnight_policy,
        cnight_name == config.cnight_name,
        assets.quantity_of(guarded_value, ada_policy_id, ada_asset_name) <= ada_amount,
        assets.quantity_of(guarded_value, cnight_policy, cnight_name) <= cnight_amount,
      }
    }

  let validation =
    fn(own_hash) {
      if logic_is_on_main(reference_inputs, two_stage_hash, own_hash) {
        merge_values(main_forever_script_hash, config.cnight_policy)
      } else {
        let datum = get_input_state_by_policy(inputs, own_hash)

        expect StagingState { forever_script_hash, cnight_test_policy }: StagingState =
          datum

        merge_values(forever_script_hash, cnight_test_policy)
      }
    }

  when info is {
    Minting(own_policy) -> {
      let datum =
        input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

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

/// V2 multisig validation logic: parameterized two-stage hash, one-shot minting.
pub fn logic_multisig_validation_nft_input_v2(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  main_forever_script_hash: ScriptHash,
  two_stage_hash: ScriptHash,
  logic_state_validation,
  threshold: ScriptHash,
  one_shot_ref: OutputReference,
) {
  let Transaction { inputs, reference_inputs, outputs, mint, .. } = transaction

  let validation =
    fn(own_hash) {
      let threshold_datum, forever_hash <-
        fn(callback) {
          if logic_is_on_main(reference_inputs, two_stage_hash, own_hash) {
            callback(
              get_input_state_by_policy(reference_inputs, threshold),
              main_forever_script_hash,
            )
          } else {
            let datum = get_input_state_by_policy(inputs, own_hash)

            expect StagingState { forever_script_hash, .. }: StagingState =
              datum

            callback(
              get_input_state_by_policy(reference_inputs, threshold),
              forever_script_hash,
            )
          }
        }

      expect logic_redeemer: LogicRedeemer = redeemer

      when logic_redeemer is {
        Normal(inner_redeemer) -> {
          expect MultisigThreshold {
            technical_auth_numerator,
            technical_auth_denominator,
            council_numerator,
            council_denominator,
          }: MultisigThreshold = threshold_datum

          let datum = get_output_state_by_policy(outputs, forever_hash)

          and {
            check_for_multisig(
              // Used in the case we are spending multisig state rather than referencing it
              if forever_hash == config.technical_authority_forever_hash {
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
              if forever_hash == config.council_forever_hash {
                inputs
              } else {
                reference_inputs
              },
              mint,
              config.council_forever_hash,
              council_numerator,
              council_denominator,
            ),
            logic_state_validation(datum, inner_redeemer),
          }
        }
        Migrate -> {
          let input_datum = get_input_state_by_policy(inputs, forever_hash)
          let output_datum = get_output_state_by_policy(outputs, forever_hash)

          logic_state_validation(output_datum, input_datum)
        }
      }
    }

  when info is {
    Minting(own_policy) -> {
      let datum =
        input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

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

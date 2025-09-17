use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{to_dict}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use multisig/types.{MultisigPolicies, MultisigPolicy}
use utils.{get_output_state_by_policy, must_find}

validator main_gov_threshold {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let Transaction { inputs, outputs, mint, .. } = transaction

    let one_shot_ref =
      OutputReference(
        config.main_gov_one_shot_hash,
        config.main_gov_one_shot_index,
      )

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

        expect multisigs: MultisigPolicies = datum

        and {
          own_policy != config.cnight_policy,
          list.all(
            multisigs,
            fn(multisig) {
              let MultisigPolicy {
                signer_state,
                threshold_numerator,
                threshold_denominator,
              } = multisig

              and {
                builtin.length_of_bytearray(signer_state) == 28,
                threshold_numerator <= threshold_denominator,
                threshold_numerator > 0,
              }
            },
          ),
        }
      }

      Spending(output, datum) -> {
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

        expect as_data(expected_nft_id)

        expect [
          Output { address: out_addr, value: out_value, datum: out_datum, .. },
          ..
        ] = outputs

        expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

        expect InlineDatum(out_datum) = out_datum

        expect multisigs: MultisigPolicies = out_datum

        list.all(
          multisigs,
          fn(multisig) {
            let MultisigPolicy {
              signer_state,
              threshold_numerator,
              threshold_denominator,
            } = multisig

            and {
              builtin.length_of_bytearray(signer_state) == 28,
              threshold_numerator <= threshold_denominator,
              threshold_numerator > 0,
            }
          },
        )
      }

      _ -> fail
    }
  }
}

validator staging_gov_threshold {
  else(_ctx) {
    todo
  }
}

validator main_council_update_threshold {
  else(_ctx) {
    todo
  }
}

validator staging_council_update_threshold {
  else(_ctx) {
    todo
  }
}

validator main_tech_auth_update_threshold {
  else(_ctx) {
    todo
  }
}

validator staging_tech_auth_update_threshold {
  else(_ctx) {
    todo
  }
}

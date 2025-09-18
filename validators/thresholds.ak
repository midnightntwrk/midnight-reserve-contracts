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
use multisig/types.{MainMultisigThreshold}
use utils.{must_find, one_shot_mint}

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
        let datum =
          one_shot_mint(inputs, mint, outputs, own_policy, one_shot_ref)

        expect MainMultisigThreshold {
          technical_auth_numerator,
          technical_auth_denominator,
          council_numerator,
          council_denominator,
        }: MainMultisigThreshold = datum

        and {
          own_policy != config.cnight_policy,
          technical_auth_numerator < technical_auth_denominator,
          council_numerator < council_denominator,
        }
      }

      Spending { output, .. } -> {
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

        expect MainMultisigThreshold {
          technical_auth_numerator,
          technical_auth_denominator,
          council_numerator,
          council_denominator,
        }: MainMultisigThreshold = out_datum

        and {
          technical_auth_numerator < technical_auth_denominator,
          council_numerator < council_denominator,
        }
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

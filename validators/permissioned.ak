use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{to_dict}
use cardano/script_context.{Minting, ScriptContext, Withdrawing}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use config
use forever/forever_contract.{forever_contract}
use logic/types.{StagingState}
use multisig/script.{check_for_multisig, create_signer}
use multisig/types.{Multisig} as t
use upgradable/two_stage_upgrade.{logic_is_on_main, two_stage_upgradable}
use utils.{foldr2, must_find}

fn permissioned_init_validation(datum: Data, redeemer: Redeemer) {
  expect Multisig { total_signers, min_signers, signers }: Multisig = datum

  let given_signers = redeemer |> builtin.un_list_data

  let
    expected_signers,
    len,
  <-
    foldr2(
      given_signers,
      [],
      0,
      fn(signer, acc_signers, len, return) {
        return([create_signer(signer), ..acc_signers], len + 1)
      },
    )

  and {
    as_data(expected_signers) == signers,
    total_signers == len,
    min_signers <= len,
  }
}

validator forever_council {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.council_one_shot_hash,
        config.council_one_shot_index,
      )

    forever_contract(
      transaction,
      redeemer,
      info,
      one_shot_ref,
      config.council_two_stage_hash,
      permissioned_init_validation,
    )
  }
}

validator two_stage_upgrade_council {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.council_one_shot_hash,
        config.council_one_shot_index,
      )

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator logic_council {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let Transaction { inputs, reference_inputs, outputs, mint, .. } =
      transaction

    let one_shot_ref =
      OutputReference(
        config.council_one_shot_hash,
        config.council_one_shot_index,
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

        let pay_cred = Script(own_policy)

        let Output { value, datum, .. } =
          must_find(
            outputs,
            fn(output) { output.address.payment_credential == pay_cred },
          )

        expect [_, ..nft_id] = value |> to_dict |> to_pairs

        expect InlineDatum(datum) = datum

        expect _: StagingState = datum

        and {
          ( nft_id |> as_data ) == as_data([Pair(own_policy, [Pair("", 1)])]),
          own_policy != config.cnight_policy,
        }
      }

      Withdrawing(Script(own_hash) as cred) ->
        if logic_is_on_main(
          reference_inputs,
          config.council_two_stage_hash,
          own_hash,
        ) {
          todo
        } else {
          let Output { value, datum, .. } =
            must_find(
              reference_inputs,
              fn(input) { cred == input.output.address.payment_credential },
            ).output

          expect [_, ..nft_id] = value |> to_dict |> to_pairs

          expect as_data(nft_id) == as_data([Pair(own_hash, [Pair("", 1)])])

          expect InlineDatum(datum) = datum

          expect StagingState { technical_authority_nft, .. }: StagingState =
            datum

          check_for_multisig(reference_inputs, mint, technical_authority_nft)
        }

      _ -> fail
    }
  }
}

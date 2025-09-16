use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/assets.{to_dict}
use cardano/script_context.{Minting, ScriptInfo}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use config
use forever/types.{Outputs}
use upgradable/two_stage_upgrade.{validate_running}
use utils.{get_output_state_by_policy, must_find}

pub fn forever_contract(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  one_shot_ref: OutputReference,
  two_stage_hash: ScriptHash,
  initial_state_validation: fn(Data, Redeemer) -> Bool,
) {
  when info is {
    Minting(own_policy) -> {
      let Transaction { inputs, mint, outputs, .. } = transaction

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

      // ensure only a single nft token with no name is minted
      // under this policy
      expect [Pair("", 1)] = tokens |> to_pairs

      let datum = get_output_state_by_policy(outputs, own_policy)

      and {
        initial_state_validation(datum, redeemer),
        own_policy != config.cnight_policy,
      }
    }

    _ -> {
      let Transaction { reference_inputs, outputs, withdrawals, .. } =
        transaction

      let main_nft_id = [Pair(two_stage_hash, [Pair("main", 1)])] |> as_data

      let main_state =
        if redeemer == as_data(Outputs) {
          let output =
            outputs
              |> must_find(
                  fn(output) {
                    expect [_, ..assets] = output.value |> to_dict |> to_pairs

                    as_data(assets) == main_nft_id
                  },
                )
          output.datum
        } else {
          let input =
            reference_inputs
              |> must_find(
                  fn(input) {
                    expect [_, ..assets] =
                      input.output.value |> to_dict |> to_pairs

                    as_data(assets) == main_nft_id
                  },
                )

          input.output.datum
        }

      expect InlineDatum(main_state) = main_state

      expect [logic, mitigation_logic, ..] = main_state |> builtin.un_list_data

      let logic = Script(logic |> builtin.un_b_data)

      let mitigation_logic = mitigation_logic |> builtin.un_b_data

      validate_running(logic, mitigation_logic, withdrawals)
    }
  }
}

use aiken/builtin
use aiken/crypto.{ScriptHash}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use config
use upgradable/two_stage_upgrade.{validate_running}
use utils.{input_linked_mint, is_singleton, must_find}

/// Staging forever contract logic - HARDCODED to read from staging NFT.
/// Used for validators that should follow the staging track.
pub fn staging_forever_contract(
  ctx: ScriptContext,
  one_shot_ref: OutputReference,
  two_stage_hash: ScriptHash,
  initial_state_validation: fn(Data, Redeemer) -> Bool,
) {
  let ScriptContext { transaction, redeemer, info } = ctx

  when info is {
    Minting(own_policy) -> {
      let Transaction { inputs, mint, outputs, .. } = transaction

      let datum =
        input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

      and {
        initial_state_validation(datum, redeemer),
        own_policy != config.cnight_policy,
      }
    }

    Spending { .. } -> {
      let Transaction { reference_inputs, withdrawals, .. } = transaction

      // HARDCODED: Find reference input with "staging" NFT (not "main")
      let input =
        reference_inputs
          |> must_find(
              fn(input) {
                is_singleton(input.output.value, two_stage_hash, "staging")
              },
            )

      let main_state = input.output.datum
      expect InlineDatum(main_state) = main_state
      expect [logic, mitigation_logic, ..] = main_state |> builtin.un_list_data

      let logic = logic |> builtin.un_b_data
      let mitigation_logic = mitigation_logic |> builtin.un_b_data

      validate_running(logic, mitigation_logic, withdrawals)
    }

    _ -> fail
  }
}

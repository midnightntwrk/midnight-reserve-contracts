use aiken/builtin
use aiken/crypto.{ScriptHash}
use cardano/script_context.{Minting, ScriptContext}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use config
use upgradable/two_stage_upgrade.{validate_running}
use utils.{input_linked_mint, is_singleton, must_find}

pub fn forever_contract(
  ctx: ScriptContext,
  one_shot_ref: OutputReference,
  two_stage_hash: ScriptHash,
  initial_state_validation: fn(Data, Redeemer) -> Bool,
) {
  let ScriptContext { transaction, redeemer, info } = ctx

  when info is {
    Minting(own_policy) -> {
      let Transaction { inputs, mint, outputs, .. } = transaction

      // (FC-1) Read the inline datum emitted by the mint, enforcing the one-shot spend and NFT layout.
      let datum =
        input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

      and {
        // (FC-2) Validate the inline datum content for the initial state.
        initial_state_validation(datum, redeemer),
        // (FC-3) Touch `config.cnight_policy` so it contributes to the script hash.
        own_policy != config.cnight_policy,
      }
    }

    _ -> {
      let Transaction { reference_inputs, withdrawals, .. } = transaction

      // (FC-4) Require a reference input that holds exactly one `main` NFT under the two-stage script.
      let input =
        reference_inputs
          |> must_find(
              fn(input) {
                is_singleton(input.output.value, two_stage_hash, "main")
              },
            )

      let main_state = input.output.datum

      // (FC-5) Ensure the reference datum is provided inline.
      expect InlineDatum(main_state) = main_state

      // (FC-6) Require the datum layout to begin with main and mitigation logic hashes.
      expect [logic, mitigation_logic, ..] = main_state |> builtin.un_list_data

      // (FC-7) Extract the recorded main logic script hash.
      let logic = logic |> builtin.un_b_data

      // (FC-8) Extract the recorded mitigation logic script hash.
      let mitigation_logic = mitigation_logic |> builtin.un_b_data

      // (FC-9) Require both recorded scripts to appear in withdrawals before allowing the spend.
      validate_running(logic, mitigation_logic, withdrawals)
    }
  }
}

use aiken/builtin
use aiken/crypto.{ScriptHash}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{Publishing, ScriptContext, Withdrawing}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use config
use upgradable/two_stage_upgrade.{two_stage_upgradable, validate_running}
use utils.{is_singleton, must_find}

pub fn forever_contract_withdraw(ctx: ScriptContext, two_stage_hash: ScriptHash) {
  let ScriptContext { transaction, info, .. } = ctx

  when info is {
    Withdrawing { .. } -> {
      let Transaction { reference_inputs, withdrawals, .. } = transaction

      // Find reference input with "main" NFT under two-stage script
      let input =
        reference_inputs
          |> must_find(
              fn(input) {
                is_singleton(input.output.value, two_stage_hash, "main")
              },
            )

      let main_state = input.output.datum

      expect InlineDatum(main_state) = main_state

      // Datum layout: [logic_hash, mitigation_logic_hash, ...]
      expect [logic, mitigation_logic, ..] = main_state |> builtin.un_list_data

      let logic = logic |> builtin.un_b_data

      let mitigation_logic = mitigation_logic |> builtin.un_b_data

      // Both logic scripts must appear in withdrawals to authorize the spend
      validate_running(logic, mitigation_logic, withdrawals)
    }

    Publishing { certificate: RegisterCredential { .. } as rc, .. } ->
      builtin.serialise_data(rc) != config.cnight_policy

    _ -> fail
  }
}

/// Withdraw contract that proxies to the 2 stage upgrade logic and mitigation_logic contract
validator cnight_mint_forever {
  else(ctx: ScriptContext) {
    forever_contract_withdraw(ctx, config.cnight_minting_two_stage_hash)
  }
}

/// Enforces two stage upgrade process for night minting
validator cnight_mint_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.cnight_minting_one_shot_hash,
        config.cnight_minting_one_shot_index,
      )

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

/// Enforces no Night tokens can be minted
validator cnight_mint_logic {
  else(_ctx: ScriptContext) {
    True
  }
}

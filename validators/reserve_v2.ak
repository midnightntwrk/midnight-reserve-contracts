use aiken/builtin
use cardano/address.{Address, Script}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{OutputReference, Transaction}
use config
use logic/reserve.{reserve_release}
use logic/types_v2.{ReserveStagingParams}
use utils.{input_linked_mint}
use utils_v2.{has_key}

/// PR 406's Cardano Reserve Release (diagrams 10 and 12–15).
validator reserve_logic_v2 {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let init_one_shot_ref =
      OutputReference(
        config.reserve_logic_v2_init_one_shot_hash,
        config.reserve_logic_v2_init_one_shot_index,
      )

    reserve_release(
      transaction,
      redeemer,
      info,
      config.reserve_two_stage_hash,
      config.reserve_forever_hash,
      config.ics_forever_hash,
      config.reserve_staging_params_hash,
      init_one_shot_ref,
    )
  }
}

/// Test-only (diagrams 11 and 11b): holds the staging track's params.
validator reserve_staging_params {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx

    let Transaction { inputs, outputs, mint, withdrawals, .. } = transaction

    when info is {
      Minting(own_policy) -> {
        let one_shot_ref =
          OutputReference(
            config.reserve_staging_params_one_shot_hash,
            config.reserve_staging_params_one_shot_index,
          )

        expect ReserveStagingParams {
          cnight_test_policy,
          forever_script_hash,
          destination_hash,
        } = input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

        // Diagram 11: the params output comes first.
        expect [params_out, ..] = outputs

        and {
          params_out.address == Address(Script(own_policy), None),
          builtin.length_of_bytearray(cnight_test_policy) == 28,
          builtin.length_of_bytearray(forever_script_hash) == 28,
          builtin.length_of_bytearray(destination_hash) == 28,
          // Touch cnight_policy so it contributes to the script hash
          own_policy != config.cnight_policy,
        }
      }

      // Diagram 11b
      Spending { .. } ->
        has_key(withdrawals, Script(config.staging_gov_auth_hash))

      _ -> fail
    }
  }
}

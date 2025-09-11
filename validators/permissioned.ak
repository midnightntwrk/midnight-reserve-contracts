use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/forever_contract.{forever_contract}
use multisig/types.{Multisig}
use upgradable/two_stage_upgrade.{two_stage_upgradable}
use utils.{foldr2}

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
        return([signer, ..acc_signers], len + 1)
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

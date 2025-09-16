use aiken/builtin
use auth/script.{auth_multisig_validation} as auth_script
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/script.{logic_multisig_validation_nft_input} as logic_script
use logic/types.{
  RefTechnicalAuthRefCouncil, RefTechnicalAuthSpendCouncil,
  SpendTechnicalAuthRefCouncil,
}
use multisig/script.{create_signer} as multisig_script
use multisig/types.{Multisig} as multisig_types
use upgradable/two_stage_upgrade.{two_stage_upgradable}
use utils.{foldr2}

fn multisig_validation(datum: Data, redeemer: Redeemer) {
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

validator council_forever {
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
      multisig_validation,
    )
  }
}

validator council_two_stage_upgrade {
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

validator council_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.council_one_shot_hash,
        config.council_one_shot_index,
      )

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      one_shot_ref,
      multisig_validation,
      RefTechnicalAuthSpendCouncil,
    )
  }
}

validator council_gov {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    auth_multisig_validation(transaction, info)
  }
}

validator tech_auth_forever {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    forever_contract(
      transaction,
      redeemer,
      info,
      one_shot_ref,
      config.technical_authority_two_stage_hash,
      multisig_validation,
    )
  }
}

validator tech_auth_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator tech_auth_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      one_shot_ref,
      multisig_validation,
      SpendTechnicalAuthRefCouncil,
    )
  }
}

validator tech_auth_gov {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    auth_multisig_validation(transaction, info)
  }
}

// Is committee operators aka federated
// block producers even needed on Cardano.
// Based on what I know I don't think so
validator committe_ops_forever {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    forever_contract(
      transaction,
      redeemer,
      info,
      one_shot_ref,
      config.technical_authority_two_stage_hash,
      multisig_validation,
    )
  }
}

validator committe_ops_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator committe_ops_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      one_shot_ref,
      multisig_validation,
      RefTechnicalAuthRefCouncil,
    )
  }
}

validator committe_ops_gov {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    auth_multisig_validation(transaction, info)
  }
}

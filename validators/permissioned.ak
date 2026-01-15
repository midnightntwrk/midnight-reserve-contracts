use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use forever/types.{FederatedOps, Versioned}
use logic/script.{logic_multisig_validation_nft_input} as logic_script
use multisig/script.{create_signer} as multisig_script
use multisig/types.{Multisig} as multisig_types
use upgradable/two_stage_upgrade.{two_stage_upgradable}
use utils.{foldr2}

/// Validates that the datum is a well-formed versioned multisig at logic round 0,
/// and that the redeemer contains a signer map matching the datum's signer list exactly.
fn validate_multisig_structure(datum: Data, redeemer: Redeemer) {
  expect Versioned { data: Multisig { total_signers, signers }, logic_round: 0 }: Versioned<
    Multisig,
  > = datum

  let given_signers = redeemer |> builtin.un_map_data

  let
    expected_signers,
    len,
  <-
    foldr2(
      given_signers,
      [],
      0,
      fn(signer, acc_signers, len, return) {
        expect _ = signer.2nd |> builtin.un_b_data
        return(
          [
            Pair(signer.1st |> builtin.un_b_data |> create_signer, signer.2nd),
            ..acc_signers
          ],
          len + 1,
        )
      },
    )

  and {
    as_data(expected_signers) == signers,
    total_signers == len,
  }
}

/// Validates that the datum is a well-formed FederatedOps structure.
fn validate_federated_ops(datum: Data, _redeemer) {
  expect _: FederatedOps = datum

  True
}

/// Council forever validator: mints and manages the immutable council NFT state.
/// Uses one-shot minting pattern and delegates to the forever contract helper.
validator council_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.council_one_shot_hash,
        config.council_one_shot_index,
      )

    forever_contract(
      ctx,
      one_shot_ref,
      config.council_two_stage_hash,
      validate_multisig_structure,
    )
  }
}

/// Council two-stage upgrade validator: manages staged upgrades for the council contract.
/// Delegates to the shared two-stage upgrade helper for minting and spending validation.
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

/// Council logic validator: enforces multisig quorum requirements for council operations.
/// Validates via withdrawal and allows stake credential registration.
validator council_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.council_forever_hash,
      validate_multisig_structure,
      config.main_council_update_threshold_hash,
    )
  }
}

/// Technical authority forever validator: mints and manages the immutable tech auth NFT state.
/// Uses one-shot minting pattern and delegates to the forever contract helper.
validator tech_auth_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    forever_contract(
      ctx,
      one_shot_ref,
      config.technical_authority_two_stage_hash,
      validate_multisig_structure,
    )
  }
}

/// Technical authority two-stage upgrade validator: manages staged upgrades for the tech auth contract.
/// Delegates to the shared two-stage upgrade helper for minting and spending validation.
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

/// Technical authority logic validator: enforces multisig quorum requirements for tech auth operations.
/// Validates via withdrawal and allows stake credential registration.
validator tech_auth_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.technical_authority_forever_hash,
      validate_multisig_structure,
      config.main_tech_auth_update_threshold_hash,
    )
  }
}

/// Federated operators forever validator: mints and manages the immutable federated ops NFT state.
/// Uses one-shot minting pattern and delegates to the forever contract helper.
validator federated_ops_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.federated_operators_one_shot_hash,
        config.federated_operators_one_shot_index,
      )

    forever_contract(
      ctx,
      one_shot_ref,
      config.federated_operators_two_stage_hash,
      validate_federated_ops,
    )
  }
}

/// Federated operators two-stage upgrade validator: manages staged upgrades for the federated ops contract.
/// Delegates to the shared two-stage upgrade helper for minting and spending validation.
validator federated_ops_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.federated_operators_one_shot_hash,
        config.federated_operators_one_shot_index,
      )

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

/// Federated operators logic validator: enforces multisig quorum requirements for federated ops updates.
/// Validates via withdrawal and allows stake credential registration.
validator federated_ops_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.federated_operators_forever_hash,
      validate_federated_ops,
      config.main_federated_ops_update_threshold_hash,
    )
  }
}

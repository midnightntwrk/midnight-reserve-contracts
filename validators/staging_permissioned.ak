use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{staging_forever_contract}
use forever/types.{FederatedOps, Versioned}
use logic/script.{logic_multisig_validation_nft_input} as logic_script
use multisig/script.{create_signer} as multisig_script
use multisig/types.{Multisig} as multisig_types
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

fn validate_federated_ops(datum: Data, _redeemer) {
  expect _: FederatedOps = datum

  True
}

// =============================================================================
// COUNCIL STAGING TRACK
// =============================================================================

/// Staging forever for council - HARDCODED to read from staging NFT.
validator council_staging_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.council_one_shot_hash,
        config.council_one_shot_index,
      )

    staging_forever_contract(
      ctx,
      one_shot_ref,
      config.council_two_stage_hash,
      validate_multisig_structure,
    )
  }
}

/// Staging logic for council - references staging forever hash.
validator council_staging_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.council_staging_forever_hash,
      validate_multisig_structure,
      config.main_council_update_threshold_hash,
    )
  }
}

// =============================================================================
// TECH AUTH STAGING TRACK
// =============================================================================

/// Staging forever for tech auth - HARDCODED to read from staging NFT.
validator tech_auth_staging_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    staging_forever_contract(
      ctx,
      one_shot_ref,
      config.technical_authority_two_stage_hash,
      validate_multisig_structure,
    )
  }
}

/// Staging logic for tech auth - references staging forever hash.
validator tech_auth_staging_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.technical_authority_staging_forever_hash,
      validate_multisig_structure,
      config.main_tech_auth_update_threshold_hash,
    )
  }
}

// =============================================================================
// FEDERATED OPS STAGING TRACK
// =============================================================================

/// Staging forever for federated ops - HARDCODED to read from staging NFT.
validator federated_ops_staging_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.federated_operators_one_shot_hash,
        config.federated_operators_one_shot_index,
      )

    staging_forever_contract(
      ctx,
      one_shot_ref,
      config.federated_operators_two_stage_hash,
      validate_federated_ops,
    )
  }
}

/// Staging logic for federated ops - references staging forever hash.
validator federated_ops_staging_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.federated_operators_staging_forever_hash,
      validate_federated_ops,
      config.main_federated_ops_update_threshold_hash,
    )
  }
}

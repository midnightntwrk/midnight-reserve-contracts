use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/types.{Versioned}
use forever/types_v2.{FederatedOpsV2}
use logic/next_version.{logic_multisig_validation_nft_input_v2}
use multisig/script.{create_signer} as multisig_script
use multisig/types.{Multisig} as multisig_types
use utils.{foldr2}

/// Validates that the datum is a well-formed versioned multisig at logic round 1,
/// and that the redeemer contains a signer map matching the datum's signer list exactly.
fn validate_multisig_structure_v2(datum: Data, redeemer: Redeemer) {
  expect Versioned { data: Multisig { total_signers, signers }, logic_round: 1 }: Versioned<
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

fn validate_federated_ops_v2(datum: Data, _redeemer) {
  expect FederatedOpsV2 { logic_round: 2, .. }: FederatedOpsV2 = datum

  True
}

/// Enforces multisig quorum for council operations via withdrawal (v2).
validator council_logic_v2 {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    let one_shot_ref =
      OutputReference(
        config.council_logic_v2_one_shot_hash,
        config.council_logic_v2_one_shot_index,
      )

    logic_multisig_validation_nft_input_v2(
      transaction,
      redeemer,
      info,
      config.council_forever_hash,
      config.council_two_stage_hash,
      validate_multisig_structure_v2,
      fn(_datum, _input) { fail },
      config.main_council_update_threshold_hash,
      one_shot_ref,
    )
  }
}

/// Enforces multisig quorum for tech auth operations via withdrawal (v2).
validator tech_auth_logic_v2 {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    let one_shot_ref =
      OutputReference(
        config.technical_authority_logic_v2_one_shot_hash,
        config.technical_authority_logic_v2_one_shot_index,
      )

    logic_multisig_validation_nft_input_v2(
      transaction,
      redeemer,
      info,
      config.technical_authority_forever_hash,
      config.technical_authority_two_stage_hash,
      validate_multisig_structure_v2,
      fn(_datum, _input) { fail },
      config.main_tech_auth_update_threshold_hash,
      one_shot_ref,
    )
  }
}

/// Enforces multisig quorum for federated ops updates via withdrawal (v2).
validator federated_ops_logic_v2 {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    let one_shot_ref =
      OutputReference(
        config.federated_operators_logic_v2_one_shot_hash,
        config.federated_operators_logic_v2_one_shot_index,
      )

    logic_multisig_validation_nft_input_v2(
      transaction,
      redeemer,
      info,
      config.federated_operators_forever_hash,
      config.federated_operators_two_stage_hash,
      validate_federated_ops_v2,
      fn(_datum, _input) { fail },
      config.main_federated_ops_update_threshold_hash,
      one_shot_ref,
    )
  }
}

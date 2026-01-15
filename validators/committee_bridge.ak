use bridge/beefy.{verify_consensus}
use bridge/types.{BeefyConsensusProof, BeefyConsensusState, BeefyThreshold}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptContext, Withdrawing}
use cardano/transaction.{OutputReference, Transaction}
use config
use forever/script.{forever_contract}
use upgradable/two_stage_upgrade.{two_stage_upgradable}
use utils.{get_input_state_by_policy, get_output_state_by_policy}

/// Committee bridge forever validator: mints and manages the BEEFY consensus state NFT.
/// Validates that the next authority set ID is greater than the current one.
validator committee_bridge_forever {
  else(ctx: ScriptContext) {
    let one_shot_ref =
      OutputReference(
        config.committee_bridge_one_shot_hash,
        config.committee_bridge_one_shot_index,
      )

    forever_contract(
      ctx,
      one_shot_ref,
      config.committee_bridge_two_stage_hash,
      fn(datum, _redeemer) {
        expect BeefyConsensusState {
          current_authority_set,
          next_authority_set,
          ..
        }: BeefyConsensusState = datum

        current_authority_set.id < next_authority_set.id
      },
    )
  }
}

/// Committee bridge two-stage upgrade validator: manages staged upgrades for the bridge contract.
/// Delegates to the shared two-stage upgrade helper for minting and spending validation.
validator committee_bridge_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.committee_bridge_one_shot_hash,
        config.committee_bridge_one_shot_index,
      )

    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

/// Committee bridge logic validator: verifies BEEFY consensus proofs for authority set updates.
/// Validates withdrawals and unregistrations via consensus proof verification against threshold requirements.
validator committee_bridge_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { info, transaction, redeemer } = ctx

    when info is {
      Withdrawing(_) |
      Publishing { certificate: UnregisterCredential { .. }, .. } -> {
        let Transaction { inputs, outputs, reference_inputs, .. } = transaction

        expect proof: BeefyConsensusProof = redeemer

        let beefy_nft = config.committee_bridge_forever_hash

        expect trusted_state: BeefyConsensusState =
          get_input_state_by_policy(inputs, beefy_nft)

        expect out_trusted_state: BeefyConsensusState =
          get_output_state_by_policy(outputs, beefy_nft)

        expect datum: BeefyThreshold =
          get_input_state_by_policy(
            reference_inputs,
            config.beefy_signer_threshold_hash,
          )

        verify_consensus(trusted_state, proof, datum, out_trusted_state)
      }

      Publishing { certificate: RegisterCredential { .. }, .. } -> True

      _ -> fail
    }
  }
}

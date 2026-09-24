use aiken/builtin
use bridge/beefy.{verify_update}
use bridge/types.{BeefyConsensusState, BeefyThreshold, BridgeUpdate}
use cardano/address.{Script}
use cardano/assets.{lovelace_of}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{Publishing, ScriptContext, Withdrawing}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use forever/script.{forever_contract}
use upgradable/two_stage_upgrade.{two_stage_upgradable}
use utils.{get_input_state_by_policy, is_singleton, must_find}

/// Light-client NFT. The bootstrap datum must be recomputable from Midnight state (MIP §Bootstrap).
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
          latest_mmr_root,
          latest_height,
          beefy_activation_block,
          current_committee,
          next_committee,
        }: BeefyConsensusState = datum

        and {
          next_committee.validator_set_id == current_committee.validator_set_id + 1,
          latest_height == beefy_activation_block - 1,
          current_committee.seat_count > 0,
          next_committee.seat_count > 0,
          builtin.length_of_bytearray(latest_mmr_root) == 32,
          builtin.length_of_bytearray(current_committee.keyset_commitment) == 32,
          builtin.length_of_bytearray(next_committee.keyset_commitment) == 32,
        }
      },
    )
  }
}

/// Staged upgrades for committee bridge contract.
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

/// Light-client update: rule 0 here, rules 1–10 in `verify_update`.
validator committee_bridge_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { info, transaction, redeemer } = ctx

    when info is {
      Withdrawing(_) -> {
        let Transaction { inputs, outputs, reference_inputs, .. } = transaction

        expect update: BridgeUpdate = redeemer

        let forever = config.committee_bridge_forever_hash

        let Input {
          output: Output { value: value_in, datum: datum_in, .. },
          ..
        } =
          must_find(
            inputs,
            fn(input) { is_singleton(input.output.value, forever, "") },
          )

        expect InlineDatum(state_in) = datum_in
        expect state_in: BeefyConsensusState = state_in

        let Output { value: value_out, datum: datum_out, .. } =
          must_find(
            outputs,
            fn(output) { output.address.payment_credential == Script(forever) },
          )

        expect is_singleton(value_out, forever, "")
        expect lovelace_of(value_out) >= lovelace_of(value_in)
        expect InlineDatum(state_out) = datum_out
        expect state_out: BeefyConsensusState = state_out

        expect threshold: BeefyThreshold =
          get_input_state_by_policy(
            reference_inputs,
            config.beefy_signer_threshold_hash,
          )

        state_out == verify_update(state_in, update, threshold)
      }

      Publishing { certificate: RegisterCredential { .. }, .. } -> True

      _ -> fail
    }
  }
}

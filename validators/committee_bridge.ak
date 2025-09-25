use aiken/collection/dict.{to_pairs}
use bridge/beefy.{verify_mmr_update_proof}
use bridge/types.{BeefyConsensusState, RelayChainProof}
use cardano/assets.{to_dict}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use forever/script.{forever_contract}
use upgradable/two_stage_upgrade.{two_stage_upgradable}
use utils.{must_find, one_shot_mint}

validator simple_bridge {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let Transaction { inputs, outputs, mint, .. } = transaction

    let one_shot_ref =
      OutputReference(
        config.committee_bridge_one_shot_hash,
        config.committee_bridge_one_shot_index,
      )
    when info is {
      Spending { output, .. } -> {
        let own_input =
          must_find(inputs, fn(input) { input.output_reference == output })

        // State of either main or staging depending on which input is spent
        let Input {
          output: Output { address, value, datum: spending_datum, .. },
          ..
        } = own_input

        expect redeemer: RelayChainProof = redeemer

        expect InlineDatum(spending_datum) = spending_datum

        expect trusted_state: BeefyConsensusState = spending_datum

        expect [_, ..nft_id] = value |> to_dict |> to_pairs

        expect [
          Output { address: out_addr, value: out_value, datum: out_datum, .. },
          ..
        ] = outputs

        expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

        expect InlineDatum(out_datum) = out_datum

        and {
          nft_id == out_nft_id,
          out_addr.payment_credential == address.payment_credential,
          as_data(verify_mmr_update_proof(trusted_state, redeemer)) == out_datum,
        }
      }

      Minting(own_policy) -> {
        let datum =
          one_shot_mint(inputs, mint, outputs, own_policy, one_shot_ref)

        expect BeefyConsensusState {
          current_authority_set,
          next_authority_set,
          ..
        }: BeefyConsensusState = datum

        current_authority_set.id < next_authority_set.id
      }

      _ -> False
    }
  }
}

validator committee_bridge_forever {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let one_shot_ref =
      OutputReference(
        config.committee_bridge_one_shot_hash,
        config.committee_bridge_one_shot_index,
      )

    forever_contract(
      transaction,
      redeemer,
      info,
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

validator committee_bridge_logic {
  else(_ctx) {
    todo
  }
}

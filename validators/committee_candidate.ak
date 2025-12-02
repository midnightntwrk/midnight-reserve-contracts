use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Script}
use cardano/assets.{quantity_of, to_dict}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{Input, Output, Transaction}
use utils.{input_linked_mint, must_find, must_find_key}

pub type CandidateAction {
  Create
  Burn
}

validator committee_candidate {
  else(ctx: ScriptContext) {
    let ScriptContext { redeemer, info, transaction } = ctx

    let Transaction { inputs, outputs, mint, extra_signatories, .. } =
      transaction

    when info is {
      Minting(own_policy) ->
        // Mint/Create
        if redeemer == as_data(Create) {
          expect [input, ..] = inputs

          let output_datum =
            input_linked_mint(
              inputs,
              mint,
              outputs,
              own_policy,
              input.output_reference,
            )

          expect pkh: VerificationKeyHash = output_datum

          list.has(extra_signatories, pkh)
        } else {
          expect [Pair(_, amount)] =
            mint
              |> to_dict
              |> to_pairs
              |> must_find_key(own_policy)
              |> to_pairs

          amount < 0
        }

      Spending { datum, output } -> {
        expect Some(datum) = datum

        expect pkh: VerificationKeyHash = datum

        expect Script(own_hash) =
          must_find(inputs, fn(input) { input.output_reference == output }).output.address.payment_credential

        let minted_quantity = quantity_of(mint, own_hash, "")
        and {
          list.has(extra_signatories, pkh),
          minted_quantity < 0,
        }
      }
      _ -> fail
    }
  }
}

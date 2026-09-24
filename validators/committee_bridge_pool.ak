use aiken/builtin
use aiken/collection/list
use cardano/address.{Credential, Script}
use cardano/transaction.{InlineDatum, Transaction}
use config
use utils.{is_singleton, must_find}

/// Funding pool: spendable only when the current light-client logic withdraws in the same transaction; that logic enforces MIP rules 12–17.
validator committee_bridge_pool {
  spend(_datum: Option<Data>, _redeemer: Data, _own_ref, tx: Transaction) {
    let Transaction { reference_inputs, withdrawals, .. } = tx

    let main =
      must_find(
        reference_inputs,
        fn(input) {
          is_singleton(
            input.output.value,
            config.committee_bridge_two_stage_hash,
            "main",
          )
        },
      )

    expect InlineDatum(main_state) = main.output.datum
    expect [logic, ..] = main_state |> builtin.un_list_data

    let logic = Script(logic |> builtin.un_b_data)

    list.any(
      withdrawals,
      fn(withdrawal: Pair<Credential, Int>) { withdrawal.1st == logic },
    )
  }

  else(_) {
    fail
  }
}

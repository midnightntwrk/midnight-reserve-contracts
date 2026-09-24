use bridge/test_fixtures as fx
use cardano/address.{Script}
use cardano/transaction.{OutputReference, Transaction, placeholder}
use committee_bridge_pool

const logic_hash = #"33333333333333333333333333333333333333333333333333333333"

const own_ref =
  OutputReference(
    #"7777777777777777777777777777777777777777777777777777777777777777",
    0,
  )

fn spend(tx: Transaction) -> Bool {
  committee_bridge_pool.committee_bridge_pool.spend(None, Void, own_ref, tx)
}

test pool_spends_with_logic_withdrawal() {
  spend(
    Transaction {
      ..placeholder,
      inputs: [fx.pool_input(0, 5_000_000)],
      reference_inputs: [fx.two_stage_main_ref(logic_hash)],
      withdrawals: [Pair(Script(logic_hash), 0)],
    },
  )
}

test pool_rejects_other_withdrawal() {
  !spend(
    Transaction {
      ..placeholder,
      inputs: [fx.pool_input(0, 5_000_000)],
      reference_inputs: [fx.two_stage_main_ref(logic_hash)],
      withdrawals: [Pair(Script(fx.forever), 0)],
    },
  )
}

test pool_rejects_no_withdrawal() {
  !spend(
    Transaction {
      ..placeholder,
      inputs: [fx.pool_input(0, 5_000_000)],
      reference_inputs: [fx.two_stage_main_ref(logic_hash)],
    },
  )
}

test pool_rejects_without_main_ref() fail {
  spend(
    Transaction {
      ..placeholder,
      inputs: [fx.pool_input(0, 5_000_000)],
      withdrawals: [Pair(Script(logic_hash), 0)],
    },
  )
}

test pool_rejects_other_purpose() fail {
  committee_bridge_pool.committee_bridge_pool.else(Void)
}

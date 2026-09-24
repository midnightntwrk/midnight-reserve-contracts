//// signer_cap measurement (spec §11). Each N has a baseline test that builds
//// the transaction and serialises the redeemer, and a logic test that also
//// runs committee_bridge_logic; the validator cost is the difference.

use aiken/builtin
use bridge/signer_cap.{Cap, state_in, state_out, update}
use bridge/signer_cap_vectors.{cap_100, cap_150, cap_170, cap_200, cap_50}
use bridge/test_fixtures as fx
use cardano/address.{Script}
use cardano/script_context.{ScriptContext, Withdrawing}
use cardano/transaction.{Transaction, placeholder}
use committee_bridge

const logic_hash = #"33333333333333333333333333333333333333333333333333333333"

fn context(cap: Cap) -> ScriptContext {
  let redeemer = update(cap)
  trace @"redeemer_cbor_bytes": builtin.length_of_bytearray(
    builtin.serialise_data(redeemer),
  )
  ScriptContext(
    Transaction {
      ..placeholder,
      inputs: [fx.forever_input(state_in(cap), 5_000_000)],
      reference_inputs: [fx.threshold_input],
      outputs: [fx.forever_output(state_out(cap), 5_000_000)],
      withdrawals: [Pair(Script(logic_hash), 0)],
    },
    redeemer,
    Withdrawing(Script(logic_hash)),
  )
}

fn baseline(cap: Cap) -> Bool {
  let ScriptContext { redeemer, .. } = context(cap)
  redeemer != builtin.i_data(0)
}

fn logic(cap: Cap) -> Bool {
  committee_bridge.committee_bridge_logic.else(context(cap))
}

test cap_50_baseline() {
  baseline(cap_50)
}

test cap_50_logic() {
  logic(cap_50)
}

test cap_100_baseline() {
  baseline(cap_100)
}

test cap_100_logic() {
  logic(cap_100)
}

test cap_150_baseline() {
  baseline(cap_150)
}

test cap_150_logic() {
  logic(cap_150)
}

test cap_170_baseline() {
  baseline(cap_170)
}

test cap_170_logic() {
  logic(cap_170)
}

test cap_200_baseline() {
  baseline(cap_200)
}

test cap_200_logic() {
  logic(cap_200)
}

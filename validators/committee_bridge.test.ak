use bridge/test_fixtures as fx
use bridge/types.{AuthoritySetCommitment, BeefyConsensusState}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{add, from_asset, from_lovelace}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptContext, Withdrawing}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use committee_bridge
use config

const logic_hash = #"33333333333333333333333333333333333333333333333333333333"

const state_in = fx.state(4, 5, 6)

const state_out =
  BeefyConsensusState {
    ..state_in,
    latest_mmr_root: fx.a_no_handover.mmr_root,
    latest_height: 7,
  }

fn update_tx(out: Output) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [fx.forever_input(state_in, 5_000_000)],
    reference_inputs: [fx.threshold_input],
    outputs: [out],
    withdrawals: [Pair(Script(logic_hash), 0)],
  }
}

fn logic(tx: Transaction) -> Bool {
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      tx,
      fx.update(fx.a_no_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

test logic_accepts_update() {
  logic(update_tx(fx.forever_output(state_out, 5_000_000)))
}

test logic_accepts_more_ada() {
  logic(update_tx(fx.forever_output(state_out, 6_000_000)))
}

// Rule 0.
test logic_rejects_less_ada() fail {
  logic(update_tx(fx.forever_output(state_out, 4_999_999)))
}

test logic_rejects_wrong_datum() {
  !logic(update_tx(fx.forever_output(state_in, 5_000_000)))
}

test logic_rejects_missing_output() fail {
  logic(
    update_tx(
      Output(
        Address(
          VerificationKey(
            #"11111111111111111111111111111111111111111111111111111111",
          ),
          None,
        ),
        from_lovelace(5_000_000) |> add(fx.forever, "", 1),
        InlineDatum(state_out),
        None,
      ),
    ),
  )
}

test logic_rejects_extra_token() fail {
  let out = fx.forever_output(state_out, 5_000_000)
  logic(
    update_tx(Output { ..out, value: out.value |> add(logic_hash, "FAKE", 1) }),
  )
}

test logic_allows_register() {
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      placeholder,
      0,
      Publishing {
        at: 0,
        certificate: RegisterCredential {
          credential: Script(logic_hash),
          deposit: Never,
        },
      },
    ),
  )
}

// Bootstrap mint.

const one_shot_ref =
  OutputReference(
    config.committee_bridge_one_shot_hash,
    config.committee_bridge_one_shot_index,
  )

fn mint(st: BeefyConsensusState) -> Bool {
  let tx =
    Transaction {
      ..placeholder,
      mint: from_asset(fx.forever, "", 1),
      inputs: [
        Input(
          one_shot_ref,
          Output(
            Address(
              VerificationKey(
                #"11111111111111111111111111111111111111111111111111111111",
              ),
              None,
            ),
            from_lovelace(5_000_000),
            InlineDatum(0),
            None,
          ),
        ),
      ],
      outputs: [fx.forever_output(st, 5_000_000)],
    }
  committee_bridge.committee_bridge_forever.else(
    ScriptContext(tx, 0, Minting(fx.forever)),
  )
}

test mint_bootstrap() {
  mint(fx.state(4, 5, 0))
}

test mint_rejects_next_not_successor() {
  !mint(fx.state(4, 6, 0))
}

test mint_rejects_height_not_activation_minus_one() {
  !mint(fx.state(4, 5, 1))
}

test mint_rejects_zero_seats() {
  let st = fx.state(4, 5, 0)
  !mint(
    BeefyConsensusState {
      ..st,
      next_committee: AuthoritySetCommitment {
        ..st.next_committee,
        seat_count: 0,
      },
    },
  )
}

test mint_rejects_short_root() {
  !mint(BeefyConsensusState { ..fx.state(4, 5, 0), latest_mmr_root: #"00" })
}

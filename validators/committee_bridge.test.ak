use bridge/test_fixtures as fx
use bridge/types.{AuthoritySetCommitment, BeefyConsensusState, BeefyThreshold}
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{add, from_asset, from_lovelace}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptContext, Withdrawing}
use cardano/transaction.{
  DatumHash, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
  placeholder,
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

test logic_rejects_wrong_datum() fail {
  logic(update_tx(fx.forever_output(state_in, 5_000_000)))
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

test logic_rejects_output_without_nft() fail {
  let out = fx.forever_output(state_out, 5_000_000)
  logic(update_tx(Output { ..out, value: from_lovelace(5_000_000) }))
}

test logic_rejects_output_with_stake_key() fail {
  let out = fx.forever_output(state_out, 5_000_000)
  logic(
    update_tx(
      Output {
        ..out,
        address: Address(
          Script(fx.forever),
          Some(
            Inline(
              VerificationKey(
                #"1111111111111111111111111111111111111111111111111111111111111111",
              ),
            ),
          ),
        ),
      },
    ),
  )
}

test logic_rejects_missing_input() fail {
  let tx = update_tx(fx.forever_output(state_out, 5_000_000))
  logic(Transaction { ..tx, inputs: [] })
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

// Funding pool, MIP rules 12–17. Cap for the two-signer update: 1_000_000 + 2 × 100_000.

const cap_threshold = BeefyThreshold(2, 3, 1_000_000, 100_000)

const handover_in = fx.state_next_signs(4, 5, 7)

const handover_out =
  BeefyConsensusState {
    latest_mmr_root: fx.b_handover.mmr_root,
    latest_height: 8,
    beefy_activation_block: 1,
    current_committee: fx.committee(5),
    next_committee: fx.leaf_next(6),
  }

fn pool_tx(
  st_in: BeefyConsensusState,
  st_out: BeefyConsensusState,
  pool_inputs: List<Input>,
  pool_outputs: List<Output>,
  fee: Int,
) -> Transaction {
  Transaction {
    ..placeholder,
    fee,
    inputs: [fx.forever_input(st_in, 5_000_000), ..pool_inputs],
    reference_inputs: [fx.threshold_input_of(cap_threshold)],
    outputs: [fx.forever_output(st_out, 5_000_000), ..pool_outputs],
    withdrawals: [Pair(Script(logic_hash), 0)],
  }
}

fn funded_handover(pool_in: Int, pool_out: Int, fee: Int) -> Bool {
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        handover_in,
        handover_out,
        [fx.pool_input(0, pool_in)],
        [fx.pool_output(pool_out)],
        fee,
      ),
      fx.update(fx.b_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

fn funded_no_handover(pool_in: Int, pool_out: Int, fee: Int) -> Bool {
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        state_in,
        state_out,
        [fx.pool_input(0, pool_in)],
        [fx.pool_output(pool_out)],
        fee,
      ),
      fx.update(fx.a_no_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

test pool_handover_debit_equals_cap_and_fee() {
  funded_handover(10_000_000, 8_800_000, 1_200_000)
}

test pool_handover_debit_below_cap() {
  funded_handover(10_000_000, 9_000_000, 1_000_000)
}

test pool_rejects_debit_above_cap() {
  !funded_handover(10_000_000, 8_799_999, 2_000_000)
}

test pool_rejects_debit_above_fee() {
  !funded_handover(10_000_000, 8_999_999, 1_000_000)
}

test pool_rejects_funded_non_handover() {
  !funded_no_handover(10_000_000, 9_999_999, 2_000_000)
}

test pool_merge_inputs_no_debit() {
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        state_in,
        state_out,
        [fx.pool_input(0, 4_000_000), fx.pool_input(1, 6_000_000)],
        [fx.pool_output(10_000_000)],
        200_000,
      ),
      fx.update(fx.a_no_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

test pool_topup_inside_update() {
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(state_in, state_out, [], [fx.pool_output(3_000_000)], 200_000),
      fx.update(fx.a_no_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

test pool_topup_with_input() {
  funded_no_handover(4_000_000, 7_000_000, 200_000)
}

// Only output 1 is the pool output; a later pool output is not summed, so it counts as debit.
test pool_extra_output_counts_as_debit() {
  !committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        handover_in,
        handover_out,
        [fx.pool_input(0, 10_000_000)],
        [fx.pool_output(8_600_000), fx.pool_output(1_400_000)],
        2_000_000,
      ),
      fx.update(fx.b_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

test pool_rejects_no_output() fail {
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        handover_in,
        handover_out,
        [fx.pool_input(0, 1_000_000)],
        [],
        1_000_000,
      ),
      fx.update(fx.b_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

fn funded_handover_with_output(out: Output) -> Bool {
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        handover_in,
        handover_out,
        [fx.pool_input(0, 10_000_000)],
        [out],
        200_000,
      ),
      fx.update(fx.b_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

// Rule 12: a datum hash would freeze the pool; any datum or script is rejected.
test pool_rejects_datum_hash() fail {
  let out = fx.pool_output(10_000_000)
  funded_handover_with_output(
    Output { ..out, datum: DatumHash(fx.keccak("frozen")) },
  )
}

test pool_rejects_inline_datum() fail {
  let out = fx.pool_output(10_000_000)
  funded_handover_with_output(Output { ..out, datum: InlineDatum(0) })
}

// A pool input with a stake part is pool money: it counts toward the debit.
test pool_staked_input_counted() {
  !committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        handover_in,
        handover_out,
        [fx.pool_input(0, 5_000_000), fx.pool_input_staked(1, 5_000_000)],
        [fx.pool_output(8_600_000)],
        2_000_000,
      ),
      fx.update(fx.b_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

// Output 1 must be the pool output; a change output there fails even with a pool output at 2.
test pool_rejects_output_at_index_two() fail {
  let change =
    Output(
      Address(
        VerificationKey(
          #"11111111111111111111111111111111111111111111111111111111",
        ),
        None,
      ),
      from_lovelace(1_000_000),
      NoDatum,
      None,
    )
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        handover_in,
        handover_out,
        [fx.pool_input(0, 10_000_000)],
        [change, fx.pool_output(9_000_000)],
        1_000_000,
      ),
      fx.update(fx.b_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

// Rule 12: the pool output must be at the pool address with no stake part.
test pool_rejects_output_with_stake_key() fail {
  let out = fx.pool_output(10_000_000)
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        handover_in,
        handover_out,
        [fx.pool_input(0, 10_000_000)],
        [
          Output {
            ..out,
            address: Address(
              Script(fx.pool),
              Some(
                Inline(
                  VerificationKey(
                    #"11111111111111111111111111111111111111111111111111111111",
                  ),
                ),
              ),
            ),
          },
        ],
        200_000,
      ),
      fx.update(fx.b_handover),
      Withdrawing(Script(logic_hash)),
    ),
  )
}

test pool_rejects_token_in_output() fail {
  let out = fx.pool_output(10_000_000)
  committee_bridge.committee_bridge_logic.else(
    ScriptContext(
      pool_tx(
        handover_in,
        handover_out,
        [fx.pool_input(0, 10_000_000)],
        [Output { ..out, value: out.value |> add(logic_hash, "FAKE", 1) }],
        200_000,
      ),
      fx.update(fx.b_handover),
      Withdrawing(Script(logic_hash)),
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

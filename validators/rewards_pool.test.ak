use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{Value, add, from_asset, from_lovelace}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, Spending, Withdrawing,
}
use cardano/transaction.{
  DatumHash, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
  placeholder,
}
use config
use logic/types.{StagingState} as logic_types
use rewards/test_fixtures.{batcher_hash, mk_outref, withdrawal_of}
use rewards/types.{Disburse, PoolRedeemer, Receive}
use rewards_pool
use staging_rewards_pool
use upgradable/types.{UpgradeState} as upgradable_types

const logic_hash = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

const other_logic = #"e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1"

const staging_forever =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const test_policy = #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const two_stage = config.rewards_pool_two_stage_hash

const main_forever = config.rewards_pool_forever_hash

const user = Address(VerificationKey(other_logic), None)

fn script_address(hash: ByteArray) -> Address {
  Address(Script(hash), None)
}

/// Two-stage "main" NFT UTXO naming `logic` as the running logic, no mitigation.
fn main_ref(logic: ByteArray) -> Input {
  Input(
    mk_outref(0),
    Output(
      script_address(two_stage),
      from_lovelace(2_000_000) |> add(two_stage, "main", 1),
      InlineDatum(UpgradeState(logic, "", "", "", 0, 0)),
      None,
    ),
  )
}

fn pool_utxo(
  forever: ByteArray,
  policy: ByteArray,
  ada: Int,
  night: Int,
) -> Output {
  Output(
    script_address(forever),
    from_lovelace(ada) |> add(policy, config.cnight_name, night),
    InlineDatum(Void),
    None,
  )
}

fn main_pool(ada: Int, night: Int) -> Output {
  pool_utxo(main_forever, config.cnight_policy, ada, night)
}

fn inputs_of(outputs: List<Output>) -> List<Input> {
  list_indexed(outputs, 1)
}

fn list_indexed(outputs: List<Output>, i: Int) -> List<Input> {
  when outputs is {
    [] -> []
    [o, ..rest] -> [Input(mk_outref(i), o), ..list_indexed(rest, i + 1)]
  }
}

fn logic_tx(
  inputs: List<Output>,
  outputs: List<Output>,
  main_logic: ByteArray,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: inputs_of(inputs),
    outputs,
    reference_inputs: [main_ref(main_logic)],
    withdrawals: [withdrawal_of(logic_hash)],
  }
}

fn run_logic(tx: Transaction, redeemer: PoolRedeemer) -> Bool {
  rewards_pool.rewards_pool_logic.else(
    ScriptContext(tx, redeemer, Withdrawing(Script(logic_hash))),
  )
}

fn receive(inputs: List<Output>, outputs: List<Output>) -> Bool {
  run_logic(logic_tx(inputs, outputs, logic_hash), Receive)
}

// -- receive (main track) ----------------------------------------------------------

test receive_ok() {
  receive(
    [main_pool(5_000_000, 100), main_pool(5_000_000, 200)],
    [main_pool(10_000_000, 300)],
  )
}

test receive_with_surplus_ok() {
  receive(
    [main_pool(5_000_000, 100), main_pool(5_000_000, 200)],
    [main_pool(11_000_000, 301), Output(user, from_lovelace(1), NoDatum, None)],
  )
}

test receive_first_output_checked() {
  receive(
    [main_pool(5_000_000, 100)],
    [main_pool(5_000_000, 100), main_pool(1_000_000, 1)],
  )
}

test receive_night_decreased() fail {
  receive(
    [main_pool(5_000_000, 100), main_pool(5_000_000, 200)],
    [main_pool(10_000_000, 299)],
  )
}

test receive_ada_decreased() fail {
  receive(
    [main_pool(5_000_000, 100), main_pool(5_000_000, 200)],
    [main_pool(9_999_999, 300)],
  )
}

test receive_without_output() fail {
  receive(
    [main_pool(5_000_000, 100)],
    [Output(user, from_lovelace(5_000_000), NoDatum, None)],
  )
}

test receive_forever_nft_consumed() fail {
  let nft =
    Output(
      script_address(main_forever),
      from_lovelace(2_000_000) |> add(main_forever, "", 1),
      InlineDatum(Void),
      None,
    )
  receive([main_pool(5_000_000, 100), nft], [main_pool(7_000_000, 100)])
}

test receive_datum_hash_output() fail {
  let out =
    Output { ..main_pool(5_000_000, 100), datum: DatumHash(other_logic) }
  receive([main_pool(5_000_000, 100)], [out])
}

test receive_no_datum_output() fail {
  let out = Output { ..main_pool(5_000_000, 100), datum: NoDatum }
  receive([main_pool(5_000_000, 100)], [out])
}

test receive_wrong_night_policy() fail {
  receive(
    [main_pool(5_000_000, 100)],
    [pool_utxo(main_forever, test_policy, 5_000_000, 100)],
  )
}

test receive_extra_asset_in_output() fail {
  let out =
    Output {
      ..main_pool(5_000_000, 100),
      value: main_pool(5_000_000, 100).value |> add(test_policy, "x", 1),
    }
  receive([main_pool(5_000_000, 100)], [out])
}

test receive_ada_only_output() fail {
  receive(
    [main_pool(5_000_000, 0)],
    [
      Output(
        script_address(main_forever),
        from_lovelace(5_000_000),
        InlineDatum(Void),
        None,
      ),
    ],
  )
}

test receive_without_main_reference() fail {
  let tx =
    Transaction {
      ..logic_tx(
        [main_pool(5_000_000, 100)],
        [main_pool(5_000_000, 100)],
        logic_hash,
      ),
      reference_inputs: [],
    }
  run_logic(tx, Receive)
}

// -- receive (staging track) ---------------------------------------------------------

fn staging_state_utxo() -> Output {
  Output(
    script_address(logic_hash),
    from_lovelace(2_000_000) |> add(logic_hash, "", 1),
    InlineDatum(
      StagingState {
        cnight_test_policy: test_policy,
        forever_script_hash: staging_forever,
      },
    ),
    None,
  )
}

fn staging_pool(ada: Int, night: Int) -> Output {
  pool_utxo(staging_forever, test_policy, ada, night)
}

test receive_staging_ok() {
  run_logic(
    logic_tx(
      [
        staging_state_utxo(),
        staging_pool(5_000_000, 100),
        staging_pool(5_000_000, 200),
      ],
      [staging_state_utxo(), staging_pool(10_000_000, 300)],
      other_logic,
    ),
    Receive,
  )
}

test receive_staging_night_decreased() fail {
  run_logic(
    logic_tx(
      [
        staging_state_utxo(),
        staging_pool(5_000_000, 100),
        staging_pool(5_000_000, 200),
      ],
      [staging_state_utxo(), staging_pool(10_000_000, 299)],
      other_logic,
    ),
    Receive,
  )
}

test receive_staging_with_main_night() fail {
  run_logic(
    logic_tx(
      [staging_state_utxo(), staging_pool(5_000_000, 100)],
      [
        staging_state_utxo(),
        pool_utxo(staging_forever, config.cnight_policy, 5_000_000, 100),
      ],
      other_logic,
    ),
    Receive,
  )
}

test receive_staging_without_state_input() fail {
  run_logic(
    logic_tx(
      [staging_pool(5_000_000, 100)],
      [staging_pool(5_000_000, 100)],
      other_logic,
    ),
    Receive,
  )
}

// -- disburse -----------------------------------------------------------------------

test disburse_ok() {
  let tx =
    Transaction {
      ..logic_tx(
        [main_pool(5_000_000, 100)],
        [main_pool(5_000_000, 0)],
        logic_hash,
      ),
      withdrawals: [
        withdrawal_of(logic_hash),
        withdrawal_of(config.rewards_batcher_hash),
      ],
    }
  run_logic(tx, Disburse)
}

test disburse_without_batcher_withdrawal() fail {
  let tx =
    Transaction {
      ..logic_tx(
        [main_pool(5_000_000, 100)],
        [main_pool(5_000_000, 0)],
        logic_hash,
      ),
      withdrawals: [withdrawal_of(logic_hash), withdrawal_of(batcher_hash)],
    }
  run_logic(tx, Disburse)
}

test publish_registration_ok() {
  let r: Data = Void
  rewards_pool.rewards_pool_logic.else(
    ScriptContext(
      placeholder,
      r,
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

/// The logic credential's unregistration with a redeemer that would pass as a withdrawal.
fn unregister(redeemer: PoolRedeemer, tx: Transaction) -> Bool {
  rewards_pool.rewards_pool_logic.else(
    ScriptContext(
      tx,
      redeemer,
      Publishing {
        at: 0,
        certificate: UnregisterCredential {
          credential: Script(logic_hash),
          refund: Never,
        },
      },
    ),
  )
}

test unregistration_with_receive() fail {
  unregister(
    Receive,
    logic_tx(
      [main_pool(5_000_000, 100)],
      [main_pool(5_000_000, 100)],
      logic_hash,
    ),
  )
}

test unregistration_with_disburse() fail {
  unregister(
    Disburse,
    Transaction {
      ..placeholder,
      withdrawals: [withdrawal_of(config.rewards_batcher_hash)],
    },
  )
}

// -- staging state mint -------------------------------------------------------------

fn one_shot(hash: ByteArray, index: Int) -> Input {
  Input(
    OutputReference(hash, index),
    Output(user, from_lovelace(5_000_000), NoDatum, None),
  )
}

fn logic_mint_tx(state: Output) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      one_shot(
        config.rewards_pool_logic_one_shot_hash,
        config.rewards_pool_logic_one_shot_index,
      ),
    ],
    outputs: [state],
    mint: from_asset(logic_hash, "", 1),
  }
}

fn run_logic_mint(tx: Transaction) -> Bool {
  let r: Data = Void
  rewards_pool.rewards_pool_logic.else(
    ScriptContext(tx, r, Minting(logic_hash)),
  )
}

test logic_mint_ok() {
  run_logic_mint(logic_mint_tx(staging_state_utxo()))
}

test logic_mint_short_forever_hash() fail {
  let state =
    Output {
      ..staging_state_utxo(),
      datum: InlineDatum(
        StagingState {
          cnight_test_policy: test_policy,
          forever_script_hash: #"cc",
        },
      ),
    }
  run_logic_mint(logic_mint_tx(state))
}

test logic_mint_without_one_shot() fail {
  run_logic_mint(
    Transaction { ..logic_mint_tx(staging_state_utxo()), inputs: [] },
  )
}

// -- forever triple ---------------------------------------------------------------------

fn forever_nft(forever: ByteArray) -> Output {
  Output(
    script_address(forever),
    from_lovelace(2_000_000) |> add(forever, "", 1),
    InlineDatum(Void),
    None,
  )
}

fn forever_mint_tx(
  forever: ByteArray,
  hash: ByteArray,
  index: Int,
  mint: Value,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [one_shot(hash, index)],
    outputs: [forever_nft(forever)],
    mint,
  }
}

test forever_mint_ok() {
  rewards_pool.rewards_pool_forever.else(
    ScriptContext(
      forever_mint_tx(
        main_forever,
        config.rewards_pool_one_shot_hash,
        config.rewards_pool_one_shot_index,
        from_asset(main_forever, "", 1),
      ),
      0,
      Minting(main_forever),
    ),
  )
}

test forever_mint_two_tokens() fail {
  rewards_pool.rewards_pool_forever.else(
    ScriptContext(
      forever_mint_tx(
        main_forever,
        config.rewards_pool_one_shot_hash,
        config.rewards_pool_one_shot_index,
        from_asset(main_forever, "", 2),
      ),
      0,
      Minting(main_forever),
    ),
  )
}

test forever_spend_needs_logic_withdrawal() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [Input(mk_outref(1), main_pool(5_000_000, 100))],
      reference_inputs: [main_ref(logic_hash)],
      withdrawals: [withdrawal_of(logic_hash)],
    }
  rewards_pool.rewards_pool_forever.else(
    ScriptContext(tx, 0, Spending(mk_outref(1), None)),
  )
}

test forever_spend_without_logic_withdrawal() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [Input(mk_outref(1), main_pool(5_000_000, 100))],
      reference_inputs: [main_ref(logic_hash)],
      withdrawals: [withdrawal_of(other_logic)],
    }
  rewards_pool.rewards_pool_forever.else(
    ScriptContext(tx, 0, Spending(mk_outref(1), None)),
  )
}

test staging_forever_mint_ok() {
  staging_rewards_pool.rewards_pool_staging_forever.else(
    ScriptContext(
      forever_mint_tx(
        staging_forever,
        config.rewards_pool_staging_one_shot_hash,
        config.rewards_pool_staging_one_shot_index,
        from_asset(staging_forever, "", 1),
      ),
      0,
      Minting(staging_forever),
    ),
  )
}

test staging_forever_mint_wrong_one_shot() fail {
  staging_rewards_pool.rewards_pool_staging_forever.else(
    ScriptContext(
      forever_mint_tx(
        staging_forever,
        config.rewards_pool_one_shot_hash,
        config.rewards_pool_one_shot_index + 7,
        from_asset(staging_forever, "", 1),
      ),
      0,
      Minting(staging_forever),
    ),
  )
}

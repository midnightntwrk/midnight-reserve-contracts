use aiken/builtin
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Credential, Inline, Script, VerificationKey}
use cardano/assets.{Value, add, from_asset, from_lovelace}
use cardano/certificate.{
  AlwaysAbstain, DelegateCredential, DelegateVote, RegisterCredential,
  UnregisterCredential,
}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, Spending, Withdrawing,
}
use cardano/transaction.{
  Datum, DatumHash, InlineDatum, Input, NoDatum, Output, OutputReference, Spend,
  Transaction, Withdraw, placeholder,
}
use config
use logic/reserve.{initial_state}
use logic/types_v2.{
  BurnInitToken, Init, MintInitTokens, Pause, Release, ReserveAction,
  ReserveRewardState, ReserveStagingParams, Unpause,
}
use reserve_v2
use upgradable/types.{UpgradeState}

/// The datum the deploy writes on a reserve forever NFT: `Constr 0 [0, 0]`.
/// Release and Pause must refuse it; Init ignores it.
const deploy_datum: Data =
  builtin.constr_data(0, [builtin.i_data(0), builtin.i_data(0)])

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

/// reserve_logic_v2's own hash in these tests.
const logic_hash = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

/// The main logic while reserve_logic_v2 is only staged.
const old_logic = #"e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1"

/// The two-stage main `auth` (main_gov_auth).
const auth_hash = #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

const other_hash = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"

const reserve = config.reserve_forever_hash

const ics = config.ics_forever_hash

const night = config.cnight_policy

const staging_reserve =
  #"c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1"

const staging_ics = #"c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2"

const test_night = #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const interval_ms = config.release_interval_ms

const window = config.release_max_validity_window_ms

const c0 = config.release_initial_reserve_star

/// min(c0, ceil(c0 × release_factor_n / release_factor_d)), computed off-chain.
const d0 = 345_205_479_507

const s0 =
  ReserveRewardState {
    curve_remaining_star: c0,
    cumulative_released_star: 0,
    next_interval_start_ms: config.release_anchor_posix_ms,
    paused: False,
  }

const s1 =
  ReserveRewardState {
    curve_remaining_star: c0 - d0,
    cumulative_released_star: d0,
    next_interval_start_ms: config.release_anchor_posix_ms + interval_ms,
    paused: False,
  }

/// The first moment the first interval may be released.
const t1 = config.release_anchor_posix_ms + interval_ms

fn at(hash: ByteArray) -> Address {
  Address(Script(hash), None)
}

fn staked(hash: ByteArray) -> Address {
  Address(Script(hash), Some(Inline(VerificationKey(other_hash))))
}

fn input(i: Int, output: Output) -> Input {
  Input(
    OutputReference(
      #"0000000000000000000000000000000000000000000000000000000000000000",
      i,
    ),
    output,
  )
}

/// The reserve two-stage main UTxO naming `logic` as the main logic.
fn two_stage_main(logic: ByteArray) -> Input {
  input(
    90,
    Output(
      at(config.reserve_two_stage_hash),
      from_lovelace(2_000_000) |> add(config.reserve_two_stage_hash, "main", 1),
      InlineDatum(UpgradeState(logic, "", auth_hash, "", 0, 0)),
      None,
    ),
  )
}

/// Diagram 11's staging params UTxO, holding reserve_staging_params's NFT.
fn params_ref() -> Input {
  input(91, params_out(params))
}

fn state(forever: ByteArray, datum: Data) -> Output {
  Output(
    at(forever),
    from_lovelace(2_000_000) |> add(forever, "", 1),
    InlineDatum(datum),
    None,
  )
}

fn night_utxo(forever: ByteArray, policy: ByteArray, qty: Int) -> Output {
  Output(
    at(forever),
    from_lovelace(5_000_000) |> add(policy, config.cnight_name, qty),
    NoDatum,
    None,
  )
}

fn ics_out(destination: ByteArray, policy: ByteArray, qty: Int) -> Output {
  Output(
    at(destination),
    from_lovelace(2_000_000) |> add(policy, config.cnight_name, qty),
    InlineDatum(Void),
    None,
  )
}

fn wallet(value) -> Output {
  Output(Address(VerificationKey(other_hash), None), value, NoDatum, None)
}

fn withdraw(tx: Transaction, action: ReserveAction) -> Bool {
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(tx, action, Withdrawing(Script(logic_hash))),
  )
}

fn mint(tx: Transaction) -> Bool {
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(tx, MintInitTokens, Minting(logic_hash)),
  )
}

fn burn(tx: Transaction) -> Bool {
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(tx, BurnInitToken, Minting(logic_hash)),
  )
}

// -----------------------------------------------------------------------------
// Diagram 10: register the credential and mint the init tokens
// -----------------------------------------------------------------------------

fn deploy_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      Input(
        OutputReference(
          config.reserve_logic_v2_init_one_shot_hash,
          config.reserve_logic_v2_init_one_shot_index,
        ),
        wallet(from_lovelace(10_000_000)),
      ),
    ],
    outputs: [
      wallet(
        from_lovelace(2_000_000)
          |> add(logic_hash, "main", 1)
          |> add(logic_hash, "staging", 1),
      ),
    ],
    mint: from_asset(logic_hash, "main", 1) |> add(logic_hash, "staging", 1),
  }
}

test d10_mint_init_tokens_ok() {
  mint(deploy_tx())
}

test d10_mint_without_seed() fail {
  mint(
    Transaction { ..deploy_tx(), inputs: [input(1, wallet(from_lovelace(1)))] },
  )
}

test d10_mint_extra_token() fail {
  mint(
    Transaction {
      ..deploy_tx(),
      mint: deploy_tx().mint |> add(logic_hash, "other", 1),
    },
  )
}

test d10_mint_two_main() fail {
  mint(
    Transaction {
      ..deploy_tx(),
      mint: deploy_tx().mint |> add(logic_hash, "main", 1),
    },
  )
}

test d10_mint_two_staging() fail {
  mint(
    Transaction {
      ..deploy_tx(),
      mint: deploy_tx().mint |> add(logic_hash, "staging", 1),
    },
  )
}

test d10_mint_wrong_name() fail {
  mint(
    Transaction {
      ..deploy_tx(),
      mint: from_asset(logic_hash, "main", 1) |> add(logic_hash, "other", 1),
    },
  )
}

test d10_publish_registration_ok() {
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(
      placeholder,
      Void,
      Publishing(0, RegisterCredential(Script(logic_hash), Never)),
    ),
  )
}

test d10_publish_unregistration() fail {
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(
      placeholder,
      Void,
      Publishing(0, UnregisterCredential(Script(logic_hash), Never)),
    ),
  )
}

test d10_publish_vote_delegation() fail {
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(
      placeholder,
      Void,
      Publishing(
        0,
        DelegateCredential(Script(logic_hash), DelegateVote(AlwaysAbstain)),
      ),
    ),
  )
}

test d10_no_spend_purpose() fail {
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(placeholder, Void, Spending(OutputReference(#"00", 0), None)),
  )
}

// -----------------------------------------------------------------------------
// Diagram 11: reserve_staging_params mints its own NFT
// -----------------------------------------------------------------------------

const params_policy = config.reserve_staging_params_hash

const params =
  ReserveStagingParams {
    cnight_test_policy: test_night,
    forever_script_hash: staging_reserve,
    destination_hash: staging_ics,
  }

fn params_out(datum: ReserveStagingParams) -> Output {
  Output(
    at(params_policy),
    from_lovelace(2_000_000) |> add(params_policy, "", 1),
    InlineDatum(datum),
    None,
  )
}

fn params_tx(datum: ReserveStagingParams) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      Input(
        OutputReference(
          config.reserve_staging_params_one_shot_hash,
          config.reserve_staging_params_one_shot_index,
        ),
        wallet(from_lovelace(10_000_000)),
      ),
    ],
    outputs: [params_out(datum)],
    mint: from_asset(params_policy, "", 1),
  }
}

fn mint_params(tx: Transaction) -> Bool {
  reserve_v2.reserve_staging_params.else(
    ScriptContext(tx, Void, Minting(params_policy)),
  )
}

test d11_mint_params_ok() {
  mint_params(params_tx(params))
}

/// The seed UTxO can be spent once, so a second mint has no seed.
test d11_mint_params_without_seed() fail {
  mint_params(
    Transaction {
      ..params_tx(params),
      inputs: [input(1, wallet(from_lovelace(10_000_000)))],
    },
  )
}

test d11_mint_two_params_tokens() fail {
  mint_params(
    Transaction {
      ..params_tx(params),
      outputs: [
        params_out(params),
        wallet(from_lovelace(2_000_000) |> add(params_policy, "", 1)),
      ],
      mint: from_asset(params_policy, "", 2),
    },
  )
}

/// The mint names a token other than the empty one; the output check alone
/// would pass, so only the name check refuses it.
test d11_mint_params_wrong_name() fail {
  mint_params(
    Transaction {
      ..params_tx(params),
      mint: from_asset(params_policy, "other", 1),
    },
  )
}

test d11_mint_params_staked() fail {
  mint_params(
    Transaction {
      ..params_tx(params),
      outputs: [Output { ..params_out(params), address: staked(params_policy) }],
    },
  )
}

test d11_mint_params_elsewhere() fail {
  mint_params(
    Transaction {
      ..params_tx(params),
      outputs: [Output { ..params_out(params), address: at(other_hash) }],
    },
  )
}

/// Diagram 11: the params output comes first.
test d11_mint_params_not_first() fail {
  mint_params(
    Transaction {
      ..params_tx(params),
      outputs: [wallet(from_lovelace(3_000_000)), params_out(params)],
    },
  )
}

test d11_mint_params_extra_token() fail {
  mint_params(
    Transaction {
      ..params_tx(params),
      outputs: [
        Output {
          ..params_out(params),
          value: params_out(params).value |> add(other_hash, "", 1),
        },
      ],
    },
  )
}

test d11_mint_params_short_policy() fail {
  mint_params(
    params_tx(ReserveStagingParams { ..params, cnight_test_policy: #"a1" }),
  )
}

test d11_mint_params_short_forever() fail {
  mint_params(
    params_tx(ReserveStagingParams { ..params, forever_script_hash: #"c1" }),
  )
}

test d11_mint_params_short_destination() fail {
  mint_params(
    params_tx(ReserveStagingParams { ..params, destination_hash: #"c2" }),
  )
}

/// The params output with the given datum in place of the inline params.
fn params_tx_with_datum(datum: Datum) -> Transaction {
  Transaction {
    ..params_tx(params),
    outputs: [Output { ..params_out(params), datum }],
  }
}

test d11_mint_params_no_datum() fail {
  mint_params(params_tx_with_datum(NoDatum))
}

test d11_mint_params_datum_hash() fail {
  mint_params(params_tx_with_datum(DatumHash(#"00")))
}

test d11_mint_params_datum_not_params() fail {
  mint_params(params_tx_with_datum(InlineDatum(Void)))
}

test d11_mint_params_datum_extra_field() fail {
  mint_params(
    params_tx_with_datum(
      InlineDatum([test_night, staging_reserve, staging_ics, other_hash]),
    ),
  )
}

// -----------------------------------------------------------------------------
// Diagram 11b: spend the staging params
// -----------------------------------------------------------------------------

fn spend_params(withdrawals: Pairs<Credential, Int>) -> Bool {
  reserve_v2.reserve_staging_params.else(
    ScriptContext(
      Transaction { ..placeholder, inputs: [params_ref()], withdrawals },
      Void,
      Spending(params_ref().output_reference, Some(as_data(params))),
    ),
  )
}

test d11b_spend_params_ok() {
  spend_params([Pair(Script(config.staging_gov_auth_hash), 0)])
}

test d11b_spend_params_without_staging_gov_auth() fail {
  spend_params([])
}

test d11b_spend_params_with_main_gov_auth() fail {
  spend_params([Pair(Script(auth_hash), 0)])
}

test d11b_params_withdraw_purpose() fail {
  reserve_v2.reserve_staging_params.else(
    ScriptContext(
      Transaction {
        ..placeholder,
        withdrawals: [Pair(Script(config.staging_gov_auth_hash), 0)],
      },
      Void,
      Withdrawing(Script(params_policy)),
    ),
  )
}

// -----------------------------------------------------------------------------
// Diagram 12a and 12b: Init
// -----------------------------------------------------------------------------

fn night_ref(forever: ByteArray, policy: ByteArray, qty: Int) -> Input {
  input(92, night_utxo(forever, policy, qty))
}

/// Init on the main track, after the staging Init burned "staging": the state
/// input holds the deploy datum, the wallet UTxO holds "main".
fn init_main_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      input(1, state(reserve, deploy_datum)),
      input(2, wallet(from_lovelace(2_000_000) |> add(logic_hash, "main", 1))),
    ],
    outputs: [state(reserve, initial_state()), wallet(from_lovelace(2_000_000))],
    reference_inputs: [
      two_stage_main(logic_hash),
      night_ref(reserve, night, c0),
    ],
    mint: from_asset(logic_hash, "main", -1),
    redeemers: [Pair(Withdraw(Script(logic_hash)), as_data(Init))],
  }
}

/// Init on the staging track: reserve_logic_v2 is only staged. The wallet UTxO
/// holds both init tokens; "main" stays in the deployer's change, unchecked.
fn init_staging_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      input(1, state(staging_reserve, deploy_datum)),
      input(
        2,
        wallet(
          from_lovelace(2_000_000)
            |> add(logic_hash, "main", 1)
            |> add(logic_hash, "staging", 1),
        ),
      ),
    ],
    outputs: [
      state(staging_reserve, initial_state()),
      wallet(from_lovelace(2_000_000) |> add(logic_hash, "main", 1)),
    ],
    reference_inputs: [
      two_stage_main(old_logic),
      params_ref(),
      night_ref(staging_reserve, test_night, c0),
    ],
    mint: from_asset(logic_hash, "staging", -1),
    redeemers: [Pair(Withdraw(Script(logic_hash)), as_data(Init))],
  }
}

/// An ADA-only reference input at the forever address comes before the NIGHT
/// one: Init still finds the NIGHT reference.
test d12a_init_night_ref_after_decoy_ok() {
  withdraw(
    Transaction {
      ..init_main_tx(),
      reference_inputs: [
        two_stage_main(logic_hash),
        input(70, night_utxo(reserve, night, 0)),
        night_ref(reserve, night, c0),
      ],
    },
    Init,
  )
}

test d12a_init_main_ok() {
  withdraw(init_main_tx(), Init)
}

/// Diagram 12a: the state output comes first.
test d12a_init_state_not_first() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      outputs: [
        wallet(from_lovelace(2_000_000)),
        state(reserve, initial_state()),
      ],
    },
    Init,
  )
}

test d12a_init_main_burn_ok() {
  burn(init_main_tx())
}

/// The deploy mint's redeemer cannot burn.
test d12_burn_with_mint_redeemer() fail {
  mint(init_main_tx())
}

/// The burn redeemer cannot mint the init tokens.
test d10_mint_with_burn_redeemer() fail {
  burn(deploy_tx())
}

test d12b_init_staging_ok() {
  withdraw(init_staging_tx(), Init)
}

test d12b_init_staging_burn_ok() {
  burn(init_staging_tx())
}

test d12_burn_without_init_withdrawal() fail {
  burn(
    Transaction {
      ..init_main_tx(),
      redeemers: [Pair(Withdraw(Script(logic_hash)), as_data(Release))],
    },
  )
}

test d12_burn_without_withdrawal() fail {
  burn(Transaction { ..init_main_tx(), redeemers: [] })
}

/// Init on the main track with this state input in place of the deploy datum.
fn init_main_from(state_in: Output) -> Bool {
  withdraw(
    Transaction {
      ..init_main_tx(),
      inputs: [input(1, state_in), ..list.drop(init_main_tx().inputs, 1)],
    },
    Init,
  )
}

test d12_init_ignores_initialized_state_ok() {
  init_main_from(state(reserve, initial_state()))
}

test d12_init_ignores_released_state_ok() {
  init_main_from(state(reserve, s1))
}

test d12_init_ignores_any_inline_datum_ok() {
  init_main_from(state(reserve, [#"ff", #"00"]))
}

test d12_init_ignores_no_datum_ok() {
  init_main_from(Output { ..state(reserve, Void), datum: NoDatum })
}

test d12_init_ignores_datum_hash_ok() {
  init_main_from(Output { ..state(reserve, Void), datum: DatumHash(#"00") })
}

test d12a_init_main_burns_staging() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      mint: from_asset(logic_hash, "staging", -1),
    },
    Init,
  )
}

test d12b_init_staging_burns_main() fail {
  withdraw(
    Transaction {
      ..init_staging_tx(),
      mint: from_asset(logic_hash, "main", -1),
    },
    Init,
  )
}

test d12_init_burns_both() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      mint: from_asset(logic_hash, "main", -1) |> add(logic_hash, "staging", -1),
    },
    Init,
  )
}

test d12_init_without_burn() fail {
  withdraw(Transaction { ..init_main_tx(), mint: assets.zero }, Init)
}

test d12_init_wrong_initial_reward_reserve() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      reference_inputs: [
        two_stage_main(logic_hash),
        night_ref(reserve, night, c0 - 1),
      ],
    },
    Init,
  )
}

/// The reserve NIGHT reference input holds R NIGHT plus a junk token.
test d12_init_night_ref_foreign_token() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      reference_inputs: [
        two_stage_main(logic_hash),
        input(
          92,
          Output {
            ..night_utxo(reserve, night, c0),
            value: night_utxo(reserve, night, c0).value
              |> add(other_hash, "", 1),
          },
        ),
      ],
    },
    Init,
  )
}

/// The state input holds the forever NFT plus a junk token.
test d12_init_state_input_foreign_token() fail {
  init_main_from(
    Output {
      ..state(reserve, deploy_datum),
      value: state(reserve, deploy_datum).value |> add(other_hash, "", 1),
    },
  )
}

/// The forever NFT sits at a wallet, and a NIGHT UTxO at the forever address
/// is spent in its place: Init would drain it.
test d12_init_state_input_outside_forever() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      inputs: [
        input(
          1,
          Output { ..state(reserve, deploy_datum), address: at(other_hash) },
        ),
        input(3, night_utxo(reserve, night, c0)),
        ..list.drop(init_main_tx().inputs, 1)
      ],
    },
    Init,
  )
}

/// The state output holds the forever NFT plus a junk token.
test d12_init_state_output_foreign_token() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      outputs: [
        Output {
          ..state(reserve, initial_state()),
          value: state(reserve, initial_state()).value |> add(other_hash, "", 1),
        },
        wallet(from_lovelace(2_000_000) |> add(logic_hash, "staging", 1)),
      ],
    },
    Init,
  )
}

/// The state output carries a reference script (user decision, 11-21).
test d12_init_state_output_reference_script() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      outputs: [
        Output {
          ..state(reserve, initial_state()),
          reference_script: Some(other_hash),
        },
        wallet(from_lovelace(2_000_000) |> add(logic_hash, "staging", 1)),
      ],
    },
    Init,
  )
}

/// The forever NFT goes to a wallet, and an ADA-only placeholder with the
/// state datum stays at the forever address.
test d12_init_state_output_to_wallet() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      outputs: [
        Output {
          ..state(reserve, initial_state()),
          value: from_lovelace(2_000_000),
        },
        Output { ..state(reserve, initial_state()), address: at(other_hash) },
      ],
    },
    Init,
  )
}

test d12_init_without_night_ref() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      reference_inputs: [two_stage_main(logic_hash)],
    },
    Init,
  )
}

test d12_init_night_ref_elsewhere() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      reference_inputs: [two_stage_main(logic_hash), night_ref(ics, night, c0)],
    },
    Init,
  )
}

test d12a_init_main_test_night() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      reference_inputs: [
        two_stage_main(logic_hash),
        night_ref(reserve, test_night, c0),
      ],
    },
    Init,
  )
}

test d12_init_wrong_state() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      outputs: [
        state(reserve, ReserveRewardState { ..initial_state(), paused: True }),
      ],
    },
    Init,
  )
}

test d12_init_takes_night() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      inputs: [
        input(1, state(reserve, deploy_datum)),
        input(3, night_utxo(reserve, night, c0)),
      ],
      outputs: [
        state(reserve, initial_state()),
        wallet(from_lovelace(5_000_000) |> add(night, config.cnight_name, c0)),
      ],
    },
    Init,
  )
}

test d12_init_extra_forever_output() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      outputs: [state(reserve, initial_state()), night_utxo(reserve, night, 0)],
    },
    Init,
  )
}

// -----------------------------------------------------------------------------
// Diagram 13: Release (PR 406 rules 1–8)
// -----------------------------------------------------------------------------

/// The first release on the main track, at the earliest moment it may run.
fn release_tx() -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      input(1, state(reserve, s0)),
      input(2, night_utxo(reserve, night, c0)),
    ],
    outputs: [
      ics_out(ics, night, d0),
      night_utxo(reserve, night, c0 - d0),
      state(reserve, s1),
    ],
    reference_inputs: [two_stage_main(logic_hash)],
    validity_range: interval.between(t1, t1 + window),
  }
}

/// release_tx with these outputs in place of its three.
fn release_with(state_out: Output, night_out: Output, ics_out: Output) -> Bool {
  withdraw(
    Transaction { ..release_tx(), outputs: [ics_out, night_out, state_out] },
    Release,
  )
}

/// release_tx from state `s`, releasing `delta` of reserve NIGHT `n`.
fn release_from(s: ReserveRewardState, n: Int, delta: Int) -> Bool {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, s)),
        input(2, night_utxo(reserve, night, n)),
      ],
      outputs: [
        ics_out(ics, night, delta),
        night_utxo(reserve, night, n - delta),
        state(
          reserve,
          ReserveRewardState {
            curve_remaining_star: s.curve_remaining_star - delta,
            cumulative_released_star: s.cumulative_released_star + delta,
            next_interval_start_ms: s.next_interval_start_ms + interval_ms,
            paused: s.paused,
          },
        ),
      ],
      validity_range: interval.between(
        s.next_interval_start_ms + interval_ms,
        s.next_interval_start_ms + interval_ms + window,
      ),
    },
    Release,
  )
}

test d13_release_ok() {
  withdraw(release_tx(), Release)
}

/// A Release that also spends a wallet input, the usual way to fund it.
test d13_release_with_fee_input_ok() {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: list.concat(
        release_tx().inputs,
        [input(3, wallet(from_lovelace(5_000_000)))],
      ),
    },
    Release,
  )
}

/// Diagram 13: the order is ICS, NIGHT, state; each swap is refused.
fn release_outputs(outputs: List<Output>) -> Bool {
  withdraw(Transaction { ..release_tx(), outputs }, Release)
}

test d13_release_order_ics_night_swapped() fail {
  release_outputs(
    [
      night_utxo(reserve, night, c0 - d0),
      ics_out(ics, night, d0),
      state(reserve, s1),
    ],
  )
}

test d13_release_order_night_state_swapped() fail {
  release_outputs(
    [
      ics_out(ics, night, d0),
      state(reserve, s1),
      night_utxo(reserve, night, c0 - d0),
    ],
  )
}

test d13_release_order_ics_state_swapped() fail {
  release_outputs(
    [
      state(reserve, s1),
      night_utxo(reserve, night, c0 - d0),
      ics_out(ics, night, d0),
    ],
  )
}

test d13_release_change_after_the_three_ok() {
  release_outputs(
    [
      ics_out(ics, night, d0),
      night_utxo(reserve, night, c0 - d0),
      state(reserve, s1),
      wallet(from_lovelace(3_000_000)),
    ],
  )
}

test d13_release_second_interval_ok() {
  release_from(s1, c0 - d0, 345_185_618_370)
}

test d13_release_last_star_ok() {
  release_from(ReserveRewardState { ..s1, curve_remaining_star: 1 }, 1, 1)
}

/// The last release empties the reserve's NIGHT; the output must then hold
/// ADA only.
test d13_release_last_star_junk() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(
          1,
          state(reserve, ReserveRewardState { ..s1, curve_remaining_star: 1 }),
        ),
        input(2, night_utxo(reserve, night, 1)),
      ],
      outputs: [
        ics_out(ics, night, 1),
        Output {
          ..night_utxo(reserve, night, 0),
          value: from_lovelace(5_000_000) |> add(other_hash, "", 1),
        },
        state(
          reserve,
          ReserveRewardState {
            curve_remaining_star: 0,
            cumulative_released_star: s1.cumulative_released_star + 1,
            next_interval_start_ms: s1.next_interval_start_ms + interval_ms,
            paused: False,
          },
        ),
      ],
      validity_range: interval.between(
        s1.next_interval_start_ms + interval_ms,
        s1.next_interval_start_ms + interval_ms + window,
      ),
    },
    Release,
  )
}

test d13_release_staging_track_ok() {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(staging_reserve, s0)),
        input(2, night_utxo(staging_reserve, test_night, c0)),
      ],
      outputs: [
        ics_out(staging_ics, test_night, d0),
        night_utxo(staging_reserve, test_night, c0 - d0),
        state(staging_reserve, s1),
      ],
      reference_inputs: [two_stage_main(old_logic), params_ref()],
    },
    Release,
  )
}

test d13_release_staging_without_params() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(staging_reserve, s0)),
        input(2, night_utxo(staging_reserve, test_night, c0)),
      ],
      outputs: [
        ics_out(staging_ics, test_night, d0),
        night_utxo(staging_reserve, test_night, c0 - d0),
        state(staging_reserve, s1),
      ],
      reference_inputs: [two_stage_main(old_logic)],
    },
    Release,
  )
}

/// A reference input at reserve_staging_params's address with the params
/// datum but not its NFT: here the old design's token under reserve_logic_v2.
test d13_release_staging_params_lookalike() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(staging_reserve, s0)),
        input(2, night_utxo(staging_reserve, test_night, c0)),
      ],
      outputs: [
        ics_out(staging_ics, test_night, d0),
        night_utxo(staging_reserve, test_night, c0 - d0),
        state(staging_reserve, s1),
      ],
      reference_inputs: [
        two_stage_main(old_logic),
        input(
          91,
          Output {
            ..params_out(params),
            value: from_lovelace(2_000_000) |> add(logic_hash, "", 1),
          },
        ),
      ],
    },
    Release,
  )
}

/// The real staging params NFT plus a junk token.
test d13_release_staging_params_foreign_token() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(staging_reserve, s0)),
        input(2, night_utxo(staging_reserve, test_night, c0)),
      ],
      outputs: [
        ics_out(staging_ics, test_night, d0),
        night_utxo(staging_reserve, test_night, c0 - d0),
        state(staging_reserve, s1),
      ],
      reference_inputs: [
        two_stage_main(old_logic),
        input(
          91,
          Output {
            ..params_out(params),
            value: params_out(params).value |> add(other_hash, "", 1),
          },
        ),
      ],
    },
    Release,
  )
}

/// The params UTxO spent instead of read by reference.
test d13_release_staging_params_spent() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(staging_reserve, s0)),
        input(2, night_utxo(staging_reserve, test_night, c0)),
        params_ref(),
      ],
      outputs: [
        ics_out(staging_ics, test_night, d0),
        night_utxo(staging_reserve, test_night, c0 - d0),
        state(staging_reserve, s1),
      ],
      reference_inputs: [two_stage_main(old_logic)],
    },
    Release,
  )
}

test d13_release_without_two_stage_main() fail {
  withdraw(Transaction { ..release_tx(), reference_inputs: [] }, Release)
}

test d13_release_from_deploy_datum() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, deploy_datum)),
        input(2, night_utxo(reserve, night, c0)),
      ],
    },
    Release,
  )
}

test d13_release_with_mint() fail {
  withdraw(
    Transaction { ..release_tx(), mint: from_asset(logic_hash, "main", -1) },
    Release,
  )
}

test d13_release_two_night_inputs() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, s0)),
        input(2, night_utxo(reserve, night, c0)),
        input(3, night_utxo(reserve, night, 1)),
      ],
    },
    Release,
  )
}

test d13_release_two_night_outputs() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      outputs: [
        ics_out(ics, night, d0),
        night_utxo(reserve, night, c0 - d0),
        state(reserve, s1),
        night_utxo(reserve, night, 0),
      ],
    },
    Release,
  )
}

test d13_release_nft_leaves() fail {
  release_with(
    wallet(state(reserve, s1).value),
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

test d13_release_two_state_inputs() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, s0)),
        input(2, night_utxo(reserve, night, c0)),
        input(3, state(reserve, s0)),
      ],
    },
    Release,
  )
}

test d13_release_two_state_outputs() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      outputs: [
        ics_out(ics, night, d0),
        night_utxo(reserve, night, c0 - d0),
        state(reserve, s1),
        state(reserve, s1),
      ],
    },
    Release,
  )
}

// Rule 1
test d13_rule1_paused() fail {
  release_from(ReserveRewardState { ..s0, paused: True }, c0, d0)
}

/// A paused state cannot release by writing itself unpaused.
test d13_rule1_paused_release_unpauses() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, ReserveRewardState { ..s0, paused: True })),
        input(2, night_utxo(reserve, night, c0)),
      ],
    },
    Release,
  )
}

// Rule 2
test d13_rule2_curve_exhausted() fail {
  release_from(ReserveRewardState { ..s1, curve_remaining_star: 0 }, 5, 0)
}

// Rule 3
test d13_rule3_one_ms_early() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      validity_range: interval.between(t1 - 1, t1 - 1 + window),
    },
    Release,
  )
}

test d13_rule3_window_too_wide() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      validity_range: interval.between(t1, t1 + window + 1),
    },
    Release,
  )
}

test d13_rule3_without_upper_bound() fail {
  withdraw(
    Transaction { ..release_tx(), validity_range: interval.after(t1) },
    Release,
  )
}

test d13_rule3_without_lower_bound() fail {
  withdraw(
    Transaction { ..release_tx(), validity_range: interval.before(t1 + window) },
    Release,
  )
}

// Rule 4
test d13_rule4_delta_too_large() fail {
  release_from(s0, c0, d0 + 1)
}

test d13_rule4_delta_too_small() fail {
  release_from(s0, c0, d0 - 1)
}

// Rule 5
test d13_rule5_reserve_loses_too_much() fail {
  release_with(
    state(reserve, s1),
    night_utxo(reserve, night, c0 - d0 - 1),
    ics_out(ics, night, d0),
  )
}

test d13_rule5_ics_short() fail {
  release_with(
    state(reserve, s1),
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0 - 1),
  )
}

test d13_rule5_ics_foreign_token() fail {
  release_with(
    state(reserve, s1),
    night_utxo(reserve, night, c0 - d0),
    Output {
      ..ics_out(ics, night, d0),
      value: ics_out(ics, night, d0).value |> add(other_hash, "", 1),
    },
  )
}

test d13_rule5_ics_staked() fail {
  release_with(
    state(reserve, s1),
    night_utxo(reserve, night, c0 - d0),
    Output { ..ics_out(ics, night, d0), address: staked(ics) },
  )
}

test d13_rule5_ics_without_inline_datum() fail {
  release_with(
    state(reserve, s1),
    night_utxo(reserve, night, c0 - d0),
    Output { ..ics_out(ics, night, d0), datum: NoDatum },
  )
}

test d13_rule5_two_ics_outputs() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      outputs: [
        ics_out(ics, night, d0),
        night_utxo(reserve, night, c0 - d0),
        state(reserve, s1),
        ics_out(ics, night, 0),
      ],
    },
    Release,
  )
}

test d13_rule5_spends_ics() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, s0)),
        input(2, night_utxo(reserve, night, c0)),
        input(3, ics_out(ics, night, 0)),
      ],
    },
    Release,
  )
}

/// The submitter spends an ICS UTxO of delta NIGHT, recreates it, and takes the
/// reserve's delta: the ICS gains nothing.
test d13_rule5_recreates_ics_utxo() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, s0)),
        input(2, night_utxo(reserve, night, c0)),
        input(3, ics_out(ics, night, d0)),
      ],
      outputs: [
        ics_out(ics, night, d0),
        night_utxo(reserve, night, c0 - d0),
        state(reserve, s1),
        wallet(from_lovelace(2_000_000) |> add(night, config.cnight_name, d0)),
      ],
    },
    Release,
  )
}

// Rule 6
test d13_rule6_curve_not_reduced() fail {
  release_with(
    state(reserve, ReserveRewardState { ..s1, curve_remaining_star: c0 }),
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

test d13_rule6_cumulative_not_raised() fail {
  release_with(
    state(reserve, ReserveRewardState { ..s1, cumulative_released_star: 0 }),
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

test d13_rule6_next_not_advanced() fail {
  release_with(
    state(
      reserve,
      ReserveRewardState {
        ..s1,
        next_interval_start_ms: config.release_anchor_posix_ms,
      },
    ),
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

test d13_rule6_pauses_itself() fail {
  release_with(
    state(reserve, ReserveRewardState { ..s1, paused: True }),
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

// Rule 7
test d13_rule7_night_input_foreign_token() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, s0)),
        input(
          2,
          Output {
            ..night_utxo(reserve, night, c0),
            value: night_utxo(reserve, night, c0).value
              |> add(other_hash, "", 1),
          },
        ),
      ],
    },
    Release,
  )
}

/// release_tx with this NIGHT input value. The NIGHT output holds exactly the
/// right NIGHT, so rule 5 passes and only rule 7 can refuse these.
fn release_night(night_in: Value) -> Bool {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, s0)),
        input(2, Output { ..night_utxo(reserve, night, c0), value: night_in }),
      ],
    },
    Release,
  )
}

/// Junk in the NIGHT input, with a policy that sorts before NIGHT's.
test d13_rule7_night_input_early_junk() fail {
  release_night(
    from_lovelace(5_000_000)
      |> add(night, config.cnight_name, c0)
      |> add(other_hash, "", 1),
  )
}

/// Junk in the NIGHT input, with a policy that sorts after NIGHT's.
test d13_rule7_night_input_late_junk() fail {
  release_night(
    from_lovelace(5_000_000)
      |> add(night, config.cnight_name, c0)
      |> add(#"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "", 1),
  )
}

/// A second asset name under the NIGHT policy.
test d13_rule7_night_input_second_name() fail {
  release_night(
    from_lovelace(5_000_000)
      |> add(night, config.cnight_name, c0)
      |> add(night, "other", 1),
  )
}

test d13_rule7_night_input_wrong_policy() fail {
  release_night(
    from_lovelace(5_000_000) |> add(test_night, config.cnight_name, c0),
  )
}

test d13_rule7_night_input_wrong_name() fail {
  release_night(from_lovelace(5_000_000) |> add(night, "other", c0))
}

test d13_rule7_test_night_on_main() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(1, state(reserve, s0)),
        input(2, night_utxo(reserve, test_night, c0)),
      ],
      outputs: [
        ics_out(ics, test_night, d0),
        night_utxo(reserve, test_night, c0 - d0),
        state(reserve, s1),
      ],
    },
    Release,
  )
}

test d13_rule7_state_input_foreign_token() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      inputs: [
        input(
          1,
          Output {
            ..state(reserve, s0),
            value: state(reserve, s0).value |> add(other_hash, "", 1),
          },
        ),
        input(2, night_utxo(reserve, night, c0)),
      ],
    },
    Release,
  )
}

// Rule 8
test d13_rule8_night_output_staked() fail {
  release_with(
    state(reserve, s1),
    Output { ..night_utxo(reserve, night, c0 - d0), address: staked(reserve) },
    ics_out(ics, night, d0),
  )
}

test d13_rule8_night_ada_taken() fail {
  release_with(
    state(reserve, s1),
    Output {
      ..night_utxo(reserve, night, c0 - d0),
      value: from_lovelace(4_999_999) |> add(night, config.cnight_name, c0 - d0),
    },
    ics_out(ics, night, d0),
  )
}

test d13_rule8_night_datum_hash() fail {
  release_with(
    state(reserve, s1),
    Output { ..night_utxo(reserve, night, c0 - d0), datum: DatumHash(#"00") },
    ics_out(ics, night, d0),
  )
}

test d13_rule8_state_output_staked() fail {
  release_with(
    Output { ..state(reserve, s1), address: staked(reserve) },
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

test d13_rule8_state_ada_taken() fail {
  release_with(
    Output {
      ..state(reserve, s1),
      value: from_lovelace(1_999_999) |> add(reserve, "", 1),
    },
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

test d13_rule8_state_output_foreign_token() fail {
  release_with(
    Output {
      ..state(reserve, s1),
      value: state(reserve, s1).value |> add(other_hash, "", 1),
    },
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

/// A Reserve output carries a reference script (user decision, 11-21).
test d13_rule8_state_output_reference_script() fail {
  release_with(
    Output { ..state(reserve, s1), reference_script: Some(other_hash) },
    night_utxo(reserve, night, c0 - d0),
    ics_out(ics, night, d0),
  )
}

test d13_rule8_night_output_reference_script() fail {
  release_with(
    state(reserve, s1),
    Output {
      ..night_utxo(reserve, night, c0 - d0),
      reference_script: Some(other_hash),
    },
    ics_out(ics, night, d0),
  )
}

/// The forever NFT goes to a wallet, and an ADA-only placeholder with the
/// state datum takes the state's place.
test d13_release_state_output_to_wallet() fail {
  withdraw(
    Transaction {
      ..release_tx(),
      outputs: [
        ics_out(ics, night, d0),
        night_utxo(reserve, night, c0 - d0),
        Output { ..state(reserve, s1), value: from_lovelace(2_000_000) },
        Output { ..state(reserve, s1), address: at(other_hash) },
      ],
    },
    Release,
  )
}

/// The continuing NIGHT output holds the right NIGHT plus a junk token.
test d13_rule5_night_output_foreign_token() fail {
  release_with(
    state(reserve, s1),
    Output {
      ..night_utxo(reserve, night, c0 - d0),
      value: night_utxo(reserve, night, c0 - d0).value
        |> add(other_hash, "", 1),
    },
    ics_out(ics, night, d0),
  )
}

// -----------------------------------------------------------------------------
// Diagrams 14 and 15: Pause and Unpause
// -----------------------------------------------------------------------------

fn pause_tx(before: Bool, after: Bool) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [
      input(1, state(reserve, ReserveRewardState { ..s1, paused: before })),
    ],
    outputs: [state(reserve, ReserveRewardState { ..s1, paused: after })],
    reference_inputs: [two_stage_main(logic_hash)],
    withdrawals: [Pair(Script(auth_hash), 0)],
  }
}

test d14_pause_ok() {
  withdraw(pause_tx(False, True), Pause)
}

test d14_pause_state_output_reference_script() fail {
  let tx = pause_tx(False, True)
  expect [state_out] = tx.outputs
  withdraw(
    Transaction {
      ..tx,
      outputs: [Output { ..state_out, reference_script: Some(other_hash) }],
    },
    Pause,
  )
}

/// Diagram 14: the state output comes first.
test d14_pause_state_not_first() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      outputs: [
        wallet(from_lovelace(2_000_000)),
        state(reserve, ReserveRewardState { ..s1, paused: True }),
      ],
    },
    Pause,
  )
}

// -----------------------------------------------------------------------------
// Each redeemer refuses the other redeemers' valid transactions
// -----------------------------------------------------------------------------

test init_redeemer_on_release_tx() fail {
  withdraw(release_tx(), Init)
}

test init_redeemer_on_pause_tx() fail {
  withdraw(pause_tx(False, True), Init)
}

test init_redeemer_on_unpause_tx() fail {
  withdraw(pause_tx(True, False), Init)
}

test release_redeemer_on_init_tx() fail {
  withdraw(init_main_tx(), Release)
}

test release_redeemer_on_pause_tx() fail {
  withdraw(pause_tx(False, True), Release)
}

test release_redeemer_on_unpause_tx() fail {
  withdraw(pause_tx(True, False), Release)
}

test pause_redeemer_on_init_tx() fail {
  withdraw(init_main_tx(), Pause)
}

test pause_redeemer_on_release_tx() fail {
  withdraw(release_tx(), Pause)
}

test pause_redeemer_on_unpause_tx() fail {
  withdraw(pause_tx(True, False), Pause)
}

test unpause_redeemer_on_init_tx() fail {
  withdraw(init_main_tx(), Unpause)
}

test unpause_redeemer_on_release_tx() fail {
  withdraw(release_tx(), Unpause)
}

test unpause_redeemer_on_pause_tx() fail {
  withdraw(pause_tx(False, True), Unpause)
}

test d15_unpause_ok() {
  withdraw(pause_tx(True, False), Unpause)
}

/// The state input holds the forever NFT plus a junk token.
test d14_pause_state_input_foreign_token() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      inputs: [
        input(
          1,
          Output {
            ..state(reserve, ReserveRewardState { ..s1, paused: False }),
            value: state(reserve, s1).value |> add(other_hash, "", 1),
          },
        ),
      ],
    },
    Pause,
  )
}

test d15_unpause_state_input_foreign_token() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      inputs: [
        input(
          1,
          Output {
            ..state(reserve, ReserveRewardState { ..s1, paused: True }),
            value: state(reserve, s1).value |> add(other_hash, "", 1),
          },
        ),
      ],
    },
    Unpause,
  )
}

test d15_unpause_state_output_foreign_token() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      outputs: [
        Output {
          ..state(reserve, ReserveRewardState { ..s1, paused: False }),
          value: state(reserve, s1).value |> add(other_hash, "", 1),
        },
      ],
    },
    Unpause,
  )
}

/// The reserve two-stage main UTxO with `mitigation_auth` set.
fn two_stage_main_mitigated() -> Input {
  input(
    90,
    Output(
      at(config.reserve_two_stage_hash),
      from_lovelace(2_000_000) |> add(config.reserve_two_stage_hash, "main", 1),
      InlineDatum(UpgradeState(logic_hash, "", auth_hash, other_hash, 0, 0)),
      None,
    ),
  )
}

/// Pause follows main's validate_running: once `mitigation_auth` is set, it
/// must withdraw too.
test d14_pause_with_mitigation_auth_ok() {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      reference_inputs: [two_stage_main_mitigated()],
      withdrawals: [Pair(Script(auth_hash), 0), Pair(Script(other_hash), 0)],
    },
    Pause,
  )
}

test d14_pause_without_mitigation_auth() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      reference_inputs: [two_stage_main_mitigated()],
    },
    Pause,
  )
}

/// Release reads no auth: with `mitigation_auth` set (after the freeze,
/// always_fails) and no withdrawal but its own, it still passes.
test d13_release_after_freeze_ok() {
  withdraw(
    Transaction {
      ..release_tx(),
      reference_inputs: [two_stage_main_mitigated()],
    },
    Release,
  )
}

test d15_unpause_sets_paused() fail {
  withdraw(pause_tx(True, True), Unpause)
}

test d14_pause_without_auth() fail {
  withdraw(Transaction { ..pause_tx(False, True), withdrawals: [] }, Pause)
}

test d14_pause_with_other_withdrawal() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      withdrawals: [Pair(Script(other_hash), 0)],
    },
    Pause,
  )
}

test d14_pause_from_deploy_datum() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      inputs: [input(1, state(reserve, deploy_datum))],
    },
    Pause,
  )
}

test d14_pause_with_mint() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      mint: from_asset(logic_hash, "main", -1),
    },
    Pause,
  )
}

test d14_pause_rewrites_curve() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      outputs: [state(reserve, ReserveRewardState { ..s0, paused: True })],
    },
    Pause,
  )
}

test d14_pause_takes_night() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      inputs: [
        input(1, state(reserve, s1)),
        input(2, night_utxo(reserve, night, c0)),
      ],
      outputs: [
        state(reserve, ReserveRewardState { ..s1, paused: True }),
        wallet(from_lovelace(5_000_000) |> add(night, config.cnight_name, c0)),
      ],
    },
    Pause,
  )
}

test d14_pause_extra_forever_output() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      outputs: [
        state(reserve, ReserveRewardState { ..s1, paused: True }),
        night_utxo(reserve, night, 0),
      ],
    },
    Pause,
  )
}

/// The state output holds the forever NFT plus a junk token.
test d14_pause_state_output_foreign_token() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      outputs: [
        Output {
          ..state(reserve, ReserveRewardState { ..s1, paused: True }),
          value: state(reserve, s1).value |> add(other_hash, "", 1),
        },
      ],
    },
    Pause,
  )
}

test d14_pause_state_output_to_wallet() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      outputs: [
        Output {
          ..state(reserve, ReserveRewardState { ..s1, paused: True }),
          value: from_lovelace(2_000_000),
        },
        Output {
          ..state(reserve, ReserveRewardState { ..s1, paused: True }),
          address: at(other_hash),
        },
      ],
    },
    Pause,
  )
}

// -----------------------------------------------------------------------------
// Unpause: the same one-off failures as Pause
// -----------------------------------------------------------------------------

/// Diagram 15: the state output comes first.
test d15_unpause_state_not_first() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      outputs: [
        wallet(from_lovelace(2_000_000)),
        state(reserve, ReserveRewardState { ..s1, paused: False }),
      ],
    },
    Unpause,
  )
}

test d15_unpause_with_mitigation_auth_ok() {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      reference_inputs: [two_stage_main_mitigated()],
      withdrawals: [Pair(Script(auth_hash), 0), Pair(Script(other_hash), 0)],
    },
    Unpause,
  )
}

test d15_unpause_without_mitigation_auth() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      reference_inputs: [two_stage_main_mitigated()],
    },
    Unpause,
  )
}

test d15_unpause_without_auth() fail {
  withdraw(Transaction { ..pause_tx(True, False), withdrawals: [] }, Unpause)
}

test d15_unpause_with_other_withdrawal() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      withdrawals: [Pair(Script(other_hash), 0)],
    },
    Unpause,
  )
}

test d15_unpause_from_deploy_datum() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      inputs: [input(1, state(reserve, deploy_datum))],
    },
    Unpause,
  )
}

test d15_unpause_with_mint() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      mint: from_asset(logic_hash, "main", -1),
    },
    Unpause,
  )
}

test d15_unpause_rewrites_curve() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      outputs: [state(reserve, ReserveRewardState { ..s0, paused: False })],
    },
    Unpause,
  )
}

test d15_unpause_takes_night() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      inputs: [
        input(1, state(reserve, ReserveRewardState { ..s1, paused: True })),
        input(2, night_utxo(reserve, night, c0)),
      ],
      outputs: [
        state(reserve, ReserveRewardState { ..s1, paused: False }),
        wallet(from_lovelace(5_000_000) |> add(night, config.cnight_name, c0)),
      ],
    },
    Unpause,
  )
}

test d15_unpause_extra_forever_output() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      outputs: [
        state(reserve, ReserveRewardState { ..s1, paused: False }),
        night_utxo(reserve, night, 0),
      ],
    },
    Unpause,
  )
}

test d15_unpause_state_output_to_wallet() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      outputs: [
        Output {
          ..state(reserve, ReserveRewardState { ..s1, paused: False }),
          value: from_lovelace(2_000_000),
        },
        Output {
          ..state(reserve, ReserveRewardState { ..s1, paused: False }),
          address: at(other_hash),
        },
      ],
    },
    Unpause,
  )
}

// -----------------------------------------------------------------------------
// Each selector picks its own candidate, not the first: a decoy sorts first
// -----------------------------------------------------------------------------

/// MintInitTokens reads its own policy: a decoy policy carries the allowed
/// [main 1, staging 1] while reserve_logic_v2 mints two of each.
test d10_mint_decoy_policy_first() fail {
  mint(
    Transaction {
      ..deploy_tx(),
      mint: from_asset(other_hash, "main", 1)
        |> add(other_hash, "staging", 1)
        |> add(logic_hash, "main", 2)
        |> add(logic_hash, "staging", 2),
    },
  )
}

/// BurnInitToken reads its own withdrawal's redeemer: a Spend redeemer that
/// sorts first is Init, the withdrawal's is Release.
test d12_burn_decoy_redeemer_first() fail {
  burn(
    Transaction {
      ..init_main_tx(),
      redeemers: [
        Pair(Spend(OutputReference(#"00", 0)), as_data(Init)),
        Pair(Withdraw(Script(logic_hash)), as_data(Release)),
      ],
    },
  )
}

/// Init reads its own policy's burn: a decoy policy burns "main" while
/// reserve_logic_v2 mints one.
test d12a_init_decoy_policy_first() fail {
  withdraw(
    Transaction {
      ..init_main_tx(),
      mint: from_asset(other_hash, "main", -1) |> add(logic_hash, "main", 1),
    },
    Init,
  )
}

/// A reference input that sorts first, holding an UpgradeState that names
/// the attacker as auth; only the attacker withdraws.
fn decoy_main() -> Input {
  input(
    80,
    Output(
      at(other_hash),
      from_lovelace(2_000_000) |> add(other_hash, "main", 1),
      InlineDatum(UpgradeState(logic_hash, "", other_hash, "", 0, 0)),
      None,
    ),
  )
}

test d14_pause_decoy_main_first() fail {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      reference_inputs: [decoy_main(), two_stage_main(logic_hash)],
      withdrawals: [Pair(Script(other_hash), 0)],
    },
    Pause,
  )
}

test d15_unpause_decoy_main_first() fail {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      reference_inputs: [decoy_main(), two_stage_main(logic_hash)],
      withdrawals: [Pair(Script(other_hash), 0)],
    },
    Unpause,
  )
}

// -----------------------------------------------------------------------------
// The ICS rule is Release's only (user decision): Init, Pause and Unpause
// accept an ICS input or output; Release refuses them (d13_rule5_spends_ics,
// d13_rule5_two_ics_outputs)
// -----------------------------------------------------------------------------

fn ics_utxo() -> Input {
  input(60, ics_out(ics, night, 5))
}

test d12a_init_with_ics_input_ok() {
  withdraw(
    Transaction {
      ..init_main_tx(),
      inputs: list.concat(init_main_tx().inputs, [ics_utxo()]),
    },
    Init,
  )
}

test d12a_init_with_ics_output_ok() {
  withdraw(
    Transaction {
      ..init_main_tx(),
      outputs: list.concat(init_main_tx().outputs, [ics_out(ics, night, 5)]),
    },
    Init,
  )
}

test d14_pause_with_ics_input_ok() {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      inputs: list.concat(pause_tx(False, True).inputs, [ics_utxo()]),
    },
    Pause,
  )
}

test d14_pause_with_ics_output_ok() {
  withdraw(
    Transaction {
      ..pause_tx(False, True),
      outputs: list.concat(
        pause_tx(False, True).outputs,
        [ics_out(ics, night, 5)],
      ),
    },
    Pause,
  )
}

test d15_unpause_with_ics_input_ok() {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      inputs: list.concat(pause_tx(True, False).inputs, [ics_utxo()]),
    },
    Unpause,
  )
}

test d15_unpause_with_ics_output_ok() {
  withdraw(
    Transaction {
      ..pause_tx(True, False),
      outputs: list.concat(
        pause_tx(True, False).outputs,
        [ics_out(ics, night, 5)],
      ),
    },
    Unpause,
  )
}

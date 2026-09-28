use aiken/builtin
use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{add, from_asset, from_lovelace}
use cardano/certificate.{UnregisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptContext, Withdrawing}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use config
use reserve_v2
use rewards/test_fixtures.{mk_outref}
use rewards/types.{Merge, Release, Releasing, ReserveRedeemer, StagingStateV2}
use upgradable/types.{UpgradeState} as upgradable_types

const logic_hash = #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

const other_logic = #"e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1"

const reserve = config.reserve_forever_hash

const pool = config.rewards_pool_forever_hash

const staging_reserve =
  #"c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1"

const staging_pool = #"c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2"

const test_policy = #"a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const interval_ms = config.release_interval_ms

/// Reserve NIGHT in every release case below.
const reserve_night = 1_000_000_000_000

/// Pool ceilings of `reserve_night` after one, two and three intervals at the default factor (computed off-chain).
const ceiling1 = 159_818

const ceiling2 = 319_636

const ceiling3 = 479_454

fn script_address(hash: ByteArray) -> Address {
  Address(Script(hash), None)
}

/// Two-stage "main" NFT UTXO of the reserve naming `logic` as the running logic.
fn main_ref(logic: ByteArray) -> Input {
  Input(
    mk_outref(0),
    Output(
      script_address(config.reserve_two_stage_hash),
      from_lovelace(2_000_000) |> add(config.reserve_two_stage_hash, "main", 1),
      InlineDatum(UpgradeState(logic, "", "", "", 0, 0)),
      None,
    ),
  )
}

/// The datum deploy puts on the reserve forever NFT: `Constr 0 [0, 0]`.
const deploy_datum: Data =
  builtin.constr_data(0, [builtin.i_data(0), builtin.i_data(0)])

fn nft_utxo(forever: ByteArray, datum: Data) -> Output {
  Output(
    script_address(forever),
    from_lovelace(2_000_000) |> add(forever, "", 1),
    InlineDatum(datum),
    None,
  )
}

fn night_utxo(
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

fn reserve_utxo(night: Int) -> Output {
  night_utxo(reserve, config.cnight_policy, 5_000_000, night)
}

fn pool_utxo(night: Int) -> Output {
  night_utxo(pool, config.cnight_policy, 5_000_000, night)
}

fn inputs_of(outputs: List<Output>, i: Int) -> List<Input> {
  when outputs is {
    [] -> []
    [o, ..rest] -> [Input(mk_outref(i), o), ..inputs_of(rest, i + 1)]
  }
}

fn run(
  inputs: List<Output>,
  outputs: List<Output>,
  now: Int,
  redeemer: ReserveRedeemer,
) -> Bool {
  let tx =
    Transaction {
      ..placeholder,
      inputs: inputs_of(inputs, 1),
      outputs,
      reference_inputs: [main_ref(logic_hash)],
      validity_range: interval.after(now),
    }
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(tx, redeemer, Withdrawing(Script(logic_hash))),
  )
}

/// The first release of a reserve deployed at time 0 with no floor, with no pool input: the pool gets `to_pool`, the reserve keeps `kept`.
fn first_release(now: Int, intervals: Int, to_pool: Int, kept: Int) -> Bool {
  run(
    [nft_utxo(reserve, Releasing(0, 0)), reserve_utxo(reserve_night)],
    [
      nft_utxo(reserve, Releasing(intervals * interval_ms, kept)),
      reserve_utxo(kept),
      pool_utxo(to_pool),
    ],
    now,
    Release { intervals },
  )
}

// -- release (main track) ----------------------------------------------------------

test release_first_interval_ok() {
  first_release(interval_ms, 1, ceiling1, reserve_night - ceiling1)
}

test release_catch_up_three_ok() {
  let last = 5 * interval_ms
  run(
    [
      nft_utxo(reserve, Releasing(last, reserve_night)),
      reserve_utxo(reserve_night),
    ],
    [
      nft_utxo(
        reserve,
        Releasing(last + 3 * interval_ms, reserve_night - ceiling3),
      ),
      reserve_utxo(reserve_night - ceiling3),
      pool_utxo(ceiling3),
    ],
    last + 3 * interval_ms,
    Release { intervals: 3 },
  )
}

/// A release after one at `last` that left `reserve_night`: spends `reserve_in` (5 ADA each), keeps `kept`, pays `to_pool`, records `floor`.
fn next_release(
  reserve_in: List<Output>,
  kept: Int,
  to_pool: Int,
  floor: Int,
) -> Bool {
  let last = 5 * interval_ms
  run(
    [nft_utxo(reserve, Releasing(last, reserve_night)), ..reserve_in],
    [
      nft_utxo(reserve, Releasing(last + interval_ms, floor)),
      night_utxo(
        reserve,
        config.cnight_policy,
        5_000_000 * list.length(reserve_in),
        kept,
      ),
      pool_utxo(to_pool),
    ],
    last + interval_ms,
    Release { intervals: 1 },
  )
}

/// Spending a 1_000-unit reserve UTXO in place of the recorded reserve would release almost nothing and still use the interval.
test release_below_floor() fail {
  next_release([reserve_utxo(1_000)], 999, 1, 999)
}

test release_floor_not_recorded() fail {
  next_release(
    [reserve_utxo(reserve_night)],
    reserve_night - ceiling1,
    ceiling1,
    reserve_night,
  )
}

test release_with_donation_above_floor_ok() {
  next_release(
    [reserve_utxo(reserve_night), reserve_utxo(1_000_000)],
    reserve_night + 1_000_000 - ceiling1,
    ceiling1,
    reserve_night + 1_000_000 - ceiling1,
  )
}

/// A reserve that still holds the deploy datum `Constr 0 [0, 0]` has not started releasing.
test release_from_deploy_datum() fail {
  run(
    [nft_utxo(reserve, deploy_datum), reserve_utxo(reserve_night)],
    [
      nft_utxo(reserve, Releasing(interval_ms, reserve_night - ceiling1)),
      reserve_utxo(reserve_night - ceiling1),
      pool_utxo(ceiling1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

test release_catch_up_240_ok() {
  first_release(240 * interval_ms, 240, 38_355_550, reserve_night - 38_355_550)
}

test release_partial_catch_up_ok() {
  first_release(5 * interval_ms, 2, ceiling2, reserve_night - ceiling2)
}

test release_net_of_pool_ok() {
  run(
    [
      nft_utxo(reserve, Releasing(0, 0)),
      reserve_utxo(reserve_night),
      pool_utxo(100_000),
    ],
    [
      nft_utxo(
        reserve,
        Releasing(interval_ms, reserve_night - ( ceiling1 - 100_000 )),
      ),
      reserve_utxo(reserve_night - ( ceiling1 - 100_000 )),
      pool_utxo(ceiling1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

test release_pool_above_ceiling_releases_nothing() {
  run(
    [
      nft_utxo(reserve, Releasing(0, 0)),
      reserve_utxo(reserve_night),
      pool_utxo(ceiling1 + 1),
    ],
    [
      nft_utxo(reserve, Releasing(interval_ms, reserve_night)),
      reserve_utxo(reserve_night),
      pool_utxo(ceiling1 + 1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

test release_too_early() fail {
  first_release(interval_ms - 1, 1, ceiling1, reserve_night - ceiling1)
}

test release_zero_intervals() fail {
  run(
    [
      nft_utxo(reserve, Releasing(interval_ms, reserve_night)),
      reserve_utxo(reserve_night),
      pool_utxo(ceiling1 + 1),
    ],
    [
      nft_utxo(reserve, Releasing(interval_ms, reserve_night)),
      reserve_utxo(reserve_night),
      pool_utxo(ceiling1 + 1),
    ],
    interval_ms,
    Release { intervals: 0 },
  )
}

test release_without_lower_bound() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: inputs_of(
        [nft_utxo(reserve, Releasing(0, 0)), reserve_utxo(reserve_night)],
        1,
      ),
      outputs: [
        nft_utxo(reserve, Releasing(interval_ms, reserve_night - ceiling1)),
        reserve_utxo(reserve_night - ceiling1),
        pool_utxo(ceiling1),
      ],
      reference_inputs: [main_ref(logic_hash)],
      validity_range: interval.everything,
    }
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(tx, Release { intervals: 1 }, Withdrawing(Script(logic_hash))),
  )
}

test release_above_ceiling() fail {
  first_release(interval_ms, 1, ceiling1 + 1, reserve_night - ceiling1 - 1)
}

test release_reserve_short() fail {
  first_release(interval_ms, 1, ceiling1, reserve_night - ceiling1 - 1)
}

test release_pool_short() fail {
  first_release(interval_ms, 1, ceiling1 - 1, reserve_night - ceiling1)
}

test release_time_not_advanced() fail {
  run(
    [nft_utxo(reserve, Releasing(0, 0)), reserve_utxo(reserve_night)],
    [
      nft_utxo(reserve, Releasing(0, 0)),
      reserve_utxo(reserve_night - ceiling1),
      pool_utxo(ceiling1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

test release_nft_value_changed() fail {
  let nft = nft_utxo(reserve, Releasing(interval_ms, reserve_night - ceiling1))
  run(
    [nft_utxo(reserve, Releasing(0, 0)), reserve_utxo(reserve_night)],
    [
      Output { ..nft, value: nft.value |> add(test_policy, "x", 1) },
      reserve_utxo(reserve_night - ceiling1),
      pool_utxo(ceiling1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

/// The release datum is larger than the deploy datum, so the NFT output may need more ADA.
test release_nft_ada_raised_ok() {
  let nft = nft_utxo(reserve, Releasing(interval_ms, reserve_night - ceiling1))
  run(
    [nft_utxo(reserve, Releasing(0, 0)), reserve_utxo(reserve_night)],
    [
      Output { ..nft, value: nft.value |> add(#"", #"", 50_000) },
      reserve_utxo(reserve_night - ceiling1),
      pool_utxo(ceiling1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

test release_without_pool_output() fail {
  run(
    [nft_utxo(reserve, Releasing(0, 0)), reserve_utxo(reserve_night)],
    [
      nft_utxo(reserve, Releasing(interval_ms, reserve_night - ceiling1)),
      reserve_utxo(reserve_night - ceiling1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

test release_pool_output_with_stake_part() fail {
  let staked =
    Output {
      ..pool_utxo(ceiling1),
      address: Address(Script(pool), Some(Inline(VerificationKey(other_logic)))),
    }
  run(
    [nft_utxo(reserve, Releasing(0, 0)), reserve_utxo(reserve_night)],
    [
      nft_utxo(reserve, Releasing(interval_ms, reserve_night - ceiling1)),
      reserve_utxo(reserve_night - ceiling1),
      staked,
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

test release_without_nft_input() fail {
  run(
    [reserve_utxo(reserve_night)],
    [
      nft_utxo(reserve, Releasing(interval_ms, reserve_night - ceiling1)),
      reserve_utxo(reserve_night - ceiling1),
      pool_utxo(ceiling1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

// -- release (staging track) -------------------------------------------------------

fn staging_state_utxo() -> Output {
  Output(
    script_address(logic_hash),
    from_lovelace(2_000_000) |> add(logic_hash, "", 1),
    InlineDatum(StagingStateV2(test_policy, staging_reserve, staging_pool)),
    None,
  )
}

test release_staging_track_ok() {
  let staged = 500_000_000_000
  let tx =
    Transaction {
      ..placeholder,
      inputs: inputs_of(
        [
          staging_state_utxo(),
          nft_utxo(staging_reserve, Releasing(0, 0)),
          night_utxo(staging_reserve, test_policy, 5_000_000, staged),
        ],
        1,
      ),
      outputs: [
        staging_state_utxo(),
        nft_utxo(staging_reserve, Releasing(interval_ms, staged - 79_909)),
        night_utxo(staging_reserve, test_policy, 5_000_000, staged - 79_909),
        night_utxo(staging_pool, test_policy, 5_000_000, 79_909),
      ],
      reference_inputs: [main_ref(other_logic)],
      validity_range: interval.after(interval_ms),
    }
  reserve_v2.reserve_logic_v2.else(
    ScriptContext(tx, Release { intervals: 1 }, Withdrawing(Script(logic_hash))),
  )
}

// -- merge -------------------------------------------------------------------------

fn merged(night: Int) -> Output {
  night_utxo(reserve, config.cnight_policy, 10_000_000, night)
}

test merge_ok() {
  run([reserve_utxo(100), reserve_utxo(200)], [merged(300)], 0, Merge)
}

test merge_night_decreased() fail {
  run([reserve_utxo(100), reserve_utxo(200)], [merged(299)], 0, Merge)
}

test merge_spends_nft() fail {
  run(
    [nft_utxo(reserve, deploy_datum), reserve_utxo(100)],
    [nft_utxo(reserve, deploy_datum), reserve_utxo(100)],
    0,
    Merge,
  )
}

// -- unregistration ----------------------------------------------------------------

/// The logic credential's unregistration, with a redeemer and tx that pass as a withdrawal.
fn unregister(
  inputs: List<Output>,
  outputs: List<Output>,
  now: Int,
  redeemer: ReserveRedeemer,
) -> Bool {
  let tx =
    Transaction {
      ..placeholder,
      inputs: inputs_of(inputs, 1),
      outputs,
      reference_inputs: [main_ref(logic_hash)],
      validity_range: interval.after(now),
    }
  reserve_v2.reserve_logic_v2.else(
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

test unregistration_with_merge() fail {
  unregister([reserve_utxo(100), reserve_utxo(200)], [merged(300)], 0, Merge)
}

test unregistration_with_release() fail {
  unregister(
    [nft_utxo(reserve, Releasing(0, 0)), reserve_utxo(reserve_night)],
    [
      nft_utxo(reserve, Releasing(interval_ms, reserve_night - ceiling1)),
      reserve_utxo(reserve_night - ceiling1),
      pool_utxo(ceiling1),
    ],
    interval_ms,
    Release { intervals: 1 },
  )
}

// -- staging state mint ------------------------------------------------------------

fn mint_ctx(datum: Data) -> ScriptContext {
  let one_shot =
    OutputReference(
      config.reserve_logic_v2_one_shot_hash,
      config.reserve_logic_v2_one_shot_index,
    )
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          one_shot,
          Output(
            Address(VerificationKey(other_logic), None),
            from_lovelace(5_000_000),
            NoDatum,
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address(logic_hash),
          from_lovelace(2_000_000) |> add(logic_hash, "", 1),
          InlineDatum(datum),
          None,
        ),
      ],
      mint: from_asset(logic_hash, "", 1),
    }
  ScriptContext(tx, Void, Minting(logic_hash))
}

test mint_staging_state_ok() {
  reserve_v2.reserve_logic_v2.else(
    mint_ctx(StagingStateV2(test_policy, staging_reserve, staging_pool)),
  )
}

test mint_staging_state_without_pool() fail {
  reserve_v2.reserve_logic_v2.else(mint_ctx([test_policy, staging_reserve]))
}

test mint_staging_state_short_pool_hash() fail {
  reserve_v2.reserve_logic_v2.else(
    mint_ctx(StagingStateV2(test_policy, staging_reserve, #"c2")),
  )
}

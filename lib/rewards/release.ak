//// Reserve logic v2 (spec §8). `Merge` keeps the v2 merge: the reserve
//// value inputs fit in one `[ada, night]` output at the reserve address,
//// and the forever NFT stays put. `Release { intervals }` fills the rewards
//// pool to the ceiling of the elapsed intervals, net of what the pool
//// already holds, and advances `last_release_time` in the forever NFT's
//// datum. The ceiling is `reserve × (1 − (1 − R)^N)` per interval, from the
//// precomputed factor `release_factor_num / release_factor_den`. Track
//// selection and the staging one-shot mint follow
//// `logic/next_version.logic_merge_v2`; the staging state adds the staging
//// pool forever hash.

use aiken/builtin
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use aiken/interval.{Finite}
use aiken/math
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{
  DatumHash, InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use rewards/types.{
  Merge, Release, ReleaseState, ReserveRedeemer, StagingStateV2,
}
use rewards/value.{split_ada}
use upgradable/two_stage_upgrade.{logic_is_on_main}
use utils.{get_input_state_by_policy, input_linked_mint, must_find}

/// The reserve forever, the NIGHT policy and the pool forever of one track.
type Track {
  reserve: ScriptHash,
  night_policy: PolicyId,
  pool: ScriptHash,
}

pub fn reserve_logic(
  tx: Transaction,
  info: ScriptInfo,
  redeemer: Data,
  two_stage_hash: ScriptHash,
  one_shot_ref: OutputReference,
) -> Bool {
  let Transaction { inputs, reference_inputs, outputs, mint, .. } = tx
  when info is {
    Minting(own_policy) -> {
      let datum =
        input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)
      expect StagingStateV2 {
        cnight_test_policy,
        forever_script_hash,
        pool_forever_hash,
      } = datum
      and {
        own_policy != config.cnight_policy,
        builtin.length_of_bytearray(cnight_test_policy) == 28,
        builtin.length_of_bytearray(forever_script_hash) == 28,
        builtin.length_of_bytearray(pool_forever_hash) == 28,
      }
    }
    Withdrawing(Script(own_hash)) |
    Publishing {
      certificate: UnregisterCredential { credential: Script(own_hash), .. },
      ..
    } -> {
      expect redeemer: ReserveRedeemer = redeemer
      let track = track(inputs, reference_inputs, two_stage_hash, own_hash)
      when redeemer is {
        Merge -> merge_ok(inputs, outputs, track)
        Release { intervals } -> release_ok(tx, track, intervals)
      }
    }
    Publishing { certificate: RegisterCredential { .. }, .. } -> True
    _ -> fail
  }
}

/// Main track: config hashes. Staging track: hashes from the own `StagingStateV2` NFT input.
fn track(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  two_stage_hash: ScriptHash,
  own_hash: ScriptHash,
) -> Track {
  if logic_is_on_main(reference_inputs, two_stage_hash, own_hash) {
    Track {
      reserve: config.reserve_forever_hash,
      night_policy: config.cnight_policy,
      pool: config.rewards_pool_forever_hash,
    }
  } else {
    expect StagingStateV2 {
      cnight_test_policy,
      forever_script_hash,
      pool_forever_hash,
    }: StagingStateV2 = get_input_state_by_policy(inputs, own_hash)
    Track {
      reserve: forever_script_hash,
      night_policy: cnight_test_policy,
      pool: pool_forever_hash,
    }
  }
}

/// No input carries the forever NFT; the value inputs fit in the first `[ada, night]` output at the reserve address.
fn merge_ok(inputs: List<Input>, outputs: List<Output>, track: Track) -> Bool {
  let (nfts, value_in) = reserve_inputs(inputs, track.reserve)
  expect nfts == []
  let reserve_address = Address(Script(track.reserve), None)
  let out = must_find(outputs, fn(o) { o.address == reserve_address })
  let ada_out, night_out <- ada_and_night(out.value, track.night_policy)
  and {
    no_datum_hash(out),
    ada_out >= assets.lovelace_of(value_in),
    night_out >= night_of(value_in, track.night_policy),
  }
}

/// Spec §8.2: release `min(reserve, max(0, ceiling − pool))` into the pool and advance the forever NFT's `last_release_time` by `intervals`.
fn release_ok(tx: Transaction, track: Track, intervals: Int) -> Bool {
  let Transaction { inputs, outputs, validity_range, .. } = tx
  expect Finite(now) = validity_range.lower_bound.bound_type
  let (nfts, reserve_in) = reserve_inputs(inputs, track.reserve)
  expect [nft_in] = nfts
  expect InlineDatum(state) = nft_in.datum
  let next = last_release_time(state) + intervals * config.release_interval_ms
  let reserve_night = night_of(reserve_in, track.night_policy)
  let pool_night = pool_input_night(inputs, track)
  let released =
    math.min(
      reserve_night,
      math.max(0, ceiling(reserve_night, intervals, 0) - pool_night),
    )
  let reserve_outs =
    list.filter(
      outputs,
      fn(o) { o.address.payment_credential == Script(track.reserve) },
    )
  let (nft_outs, value_outs) =
    list.partition(
      reserve_outs,
      fn(o) { assets.quantity_of(o.value, track.reserve, "") == 1 },
    )
  expect [nft_out] = nft_outs
  expect [value_out] = value_outs
  expect [pool_out] =
    list.filter(
      outputs,
      fn(o) { o.address.payment_credential == Script(track.pool) },
    )
  let
    reserve_ada,
    reserve_night_out,
  <- ada_and_night(value_out.value, track.night_policy)
  let _, pool_night_out <- ada_and_night(pool_out.value, track.night_policy)
  expect InlineDatum(_) = pool_out.datum
  and {
    intervals >= 1,
    next <= now,
    nft_out.address == nft_in.address,
    nft_out.value == nft_in.value,
    nft_out.datum == InlineDatum(ReleaseState { last_release_time: next }),
    value_out.address == Address(Script(track.reserve), None),
    no_datum_hash(value_out),
    reserve_ada >= assets.lovelace_of(reserve_in),
    reserve_night_out == reserve_night - released,
    pool_night_out >= pool_night + released,
  }
}

/// `last_release_time` from the forever NFT's datum; the deploy datum `Constr 0 [0, 0]` means no release yet.
fn last_release_time(state: Data) -> Int {
  when builtin.un_constr_data(state).2nd is {
    [time] -> builtin.un_i_data(time)
    [_, _] -> config.release_t0_ms
    _ -> fail
  }
}

/// Pool ceiling after `intervals` steps; each adds the factor of what the previous left, rounded up.
fn ceiling(reserve: Int, intervals: Int, acc: Int) -> Int {
  if intervals == 0 {
    acc
  } else {
    let step =
      (
        ( reserve - acc ) * config.release_factor_num + config.release_factor_den - 1
      ) / config.release_factor_den
    ceiling(reserve, intervals - 1, acc + step)
  }
}

/// The reserve inputs carrying the forever NFT, and the summed value of the others.
fn reserve_inputs(
  inputs: List<Input>,
  reserve: ScriptHash,
) -> (List<Output>, Value) {
  let cred = Script(reserve)
  list.foldr(
    inputs,
    ([], assets.zero),
    fn(input, acc) {
      let out = input.output
      let (nfts, value) = acc
      if out.address.payment_credential != cred {
        acc
      } else if assets.quantity_of(out.value, reserve, "") == 0 {
        (nfts, assets.merge(out.value, value))
      } else {
        ([out, ..nfts], value)
      }
    },
  )
}

/// NIGHT in the pool value inputs; none may carry the pool forever NFT.
fn pool_input_night(inputs: List<Input>, track: Track) -> Int {
  let cred = Script(track.pool)
  list.foldl(
    inputs,
    0,
    fn(input, acc) {
      let Output { address, value, .. } = input.output
      if address.payment_credential == cred {
        expect assets.quantity_of(value, track.pool, "") == 0
        acc + night_of(value, track.night_policy)
      } else {
        acc
      }
    },
  )
}

/// `value` is exactly `[ada, night]` under `policy`.
fn ada_and_night(
  value: Value,
  policy: PolicyId,
  return: fn(Int, Int) -> result,
) -> result {
  let ada, rest <- split_ada(value)
  expect [Pair(night_policy, tokens)]: Pairs<PolicyId, Pairs<AssetName, Int>> =
    rest
  expect [Pair(name, night)] = tokens
  expect night_policy == policy && name == config.cnight_name
  return(ada, night)
}

fn night_of(value: Value, policy: PolicyId) -> Int {
  assets.quantity_of(value, policy, config.cnight_name)
}

fn no_datum_hash(output: Output) -> Bool {
  when output.datum is {
    DatumHash(_) -> False
    _ -> True
  }
}

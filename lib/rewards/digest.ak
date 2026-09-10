//// Rewards digest proof from the bridge (spec §7, §7.1): a positional MMR
//// proof of the BEEFY leaf for block `N + 1`, the SCALE header of block
//// `N`, and the index of the `Consensus("MNRW", payload)` log in it.
////
//// Header layout (`sp_runtime::generic::Header<u32, BlakeTwo256>`):
//// `parent_hash(32) || Compact(number) || state_root(32) ||
//// extrinsics_root(32) || Compact(n_logs) || log*`, hashed with
//// blake2b-256. `parse_rewards_digest` is the only place that knows the
//// 105-byte payload layout.

use aiken/builtin
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use config
use rewards/mmr.{verify_leaf}
use rewards/scale.{compact, le}
use rewards/types.{Digest, DigestProof}

const tag_other = 0

const tag_consensus = 4

const tag_seal = 5

const tag_pre_runtime = 6

const tag_runtime_environment_updated = 8

pub fn header_hash(header: ByteArray) -> ByteArray {
  builtin.blake2b_256(header)
}

/// The block number: `Compact(number)` right after `parent_hash`.
pub fn header_number(header: ByteArray) -> Int {
  let number, _ <- compact(header, 32)
  number
}

/// The `log_index`-th digest item as `(tag, engine_id or "", payload)`.
pub fn header_digest_log(
  header: ByteArray,
  log_index: Int,
  callback: fn(Int, ByteArray, ByteArray) -> r,
) -> r {
  let _number, at <- compact(header, 32)
  let n_logs, at <- compact(header, at + 64)
  expect log_index >= 0 && log_index < n_logs
  skip_logs(header, at, log_index, callback)
}

fn skip_logs(
  header: ByteArray,
  at: Int,
  remaining: Int,
  callback: fn(Int, ByteArray, ByteArray) -> r,
) -> r {
  let tag = builtin.index_bytearray(header, at)
  if remaining == 0 {
    read_log(header, tag, at + 1, callback)
  } else {
    let next <- log_end(header, tag, at + 1)
    skip_logs(header, next, remaining - 1, callback)
  }
}

fn read_log(
  header: ByteArray,
  tag: Int,
  at: Int,
  callback: fn(Int, ByteArray, ByteArray) -> r,
) -> r {
  if tag == tag_other {
    let len, at <- compact(header, at)
    callback(tag, "", builtin.slice_bytearray(at, len, header))
  } else if tag == tag_runtime_environment_updated {
    callback(tag, "", "")
  } else {
    expect tag == tag_consensus || tag == tag_seal || tag == tag_pre_runtime
    let engine = builtin.slice_bytearray(at, 4, header)
    let len, at <- compact(header, at + 4)
    callback(tag, engine, builtin.slice_bytearray(at, len, header))
  }
}

/// Offset just past the log whose body starts at `at`.
fn log_end(header: ByteArray, tag: Int, at: Int, callback: fn(Int) -> r) -> r {
  if tag == tag_other {
    let len, at <- compact(header, at)
    callback(at + len)
  } else if tag == tag_runtime_environment_updated {
    callback(at)
  } else {
    expect tag == tag_consensus || tag == tag_seal || tag == tag_pre_runtime
    let len, at <- compact(header, at + 4)
    callback(at + len)
  }
}

/// Decode the `MNRW` payload: variant 1, then
/// `epoch u64 LE @1 | leaf_count u64 LE @9 | root @17 | min_key @49 | max_key @77`.
pub fn parse_rewards_digest(engine: ByteArray, payload: ByteArray) -> Digest {
  expect engine == config.rewards_digest_engine_id
  expect builtin.length_of_bytearray(payload) == 105
  expect builtin.index_bytearray(payload, 0) == 1
  Digest {
    epoch: le(payload, 1, 8),
    leaf_count: le(payload, 9, 8),
    root: builtin.slice_bytearray(17, 32, payload),
    min_key: builtin.slice_bytearray(49, 28, payload),
    max_key: builtin.slice_bytearray(77, 28, payload),
  }
}

/// Prove the leaf against `mmr_root`, bind the header to the leaf, and
/// decode the rewards digest from the header's `log_index`-th log.
pub fn verify_digest(mmr_root: ByteArray, proof: DigestProof) -> Digest {
  let DigestProof { leaf, leaf_index, leaf_count, items, header, log_index } =
    proof
  let leaf_hash = scale_encode_beefy_mmr_leaf(leaf) |> builtin.keccak_256
  expect verify_leaf(mmr_root, leaf_hash, leaf_index, leaf_count, items)
  expect header_hash(header) == leaf.parent_hash
  expect header_number(header) == leaf.parent_number
  let tag, engine, payload <- header_digest_log(header, log_index)
  expect tag == tag_consensus
  parse_rewards_digest(engine, payload)
}

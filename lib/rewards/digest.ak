//// Rewards digest proof from the bridge (spec §7, §7.1; bridge spec §13):
//// an MMR proof of the BEEFY leaf for block `N + 1` (leaf index `N`) under
//// the bridge's root of `latest_height` leaves, the SCALE header of block
//// `N`, and the `extrinsics_root` trie proof of the `submit_rewards_digest`
//// extrinsic in block `N`.
////
//// Header layout (`sp_runtime::generic::Header<u32, BlakeTwo256>`):
//// `parent_hash(32) || Compact(number) || state_root(32) ||
//// extrinsics_root(32) || Compact(n_logs) || log*`, hashed with
//// blake2b-256. Extrinsic layout (bare `UncheckedExtrinsic`):
//// `Compact(123) || 0x04 | 0x05 || pallet || call || epoch u64 LE ||
//// leaf_count u64 LE || root 32 || min_key 28 || max_key 28 ||
//// treasury_total u128 LE`.

use aiken/builtin
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/merkle.{verify_mmr_leaf}
use config
use rewards/scale.{compact, compact_encode, le}
use rewards/trie
use rewards/types.{Digest, DigestProof}

const call_length = 123

pub fn header_hash(header: ByteArray) -> ByteArray {
  builtin.blake2b_256(header)
}

/// The block number: `Compact(number)` right after `parent_hash`.
pub fn header_number(header: ByteArray) -> Int {
  let number, _ <- compact(header, 32)
  number
}

/// `extrinsics_root`: 32 bytes after `state_root`.
pub fn header_extrinsics_root(header: ByteArray) -> ByteArray {
  let _number, at <- compact(header, 32)
  builtin.slice_bytearray(at + 32, 32, header)
}

/// Decode a bare `submit_rewards_digest` extrinsic; nothing else is accepted.
pub fn parse_rewards_call(extrinsic: ByteArray) -> Digest {
  let len, at <- compact(extrinsic, 0)
  expect len == call_length
  expect builtin.length_of_bytearray(extrinsic) == at + call_length
  let preamble = builtin.index_bytearray(extrinsic, at)
  expect preamble == 4 || preamble == 5
  expect
    builtin.index_bytearray(extrinsic, at + 1) == config.rewards_pallet_index
  expect builtin.index_bytearray(extrinsic, at + 2) == config.rewards_call_index
  let at = at + 3
  Digest {
    epoch: le(extrinsic, at, 8),
    leaf_count: le(extrinsic, at + 8, 8),
    root: builtin.slice_bytearray(at + 16, 32, extrinsic),
    min_key: builtin.slice_bytearray(at + 48, 28, extrinsic),
    max_key: builtin.slice_bytearray(at + 76, 28, extrinsic),
    treasury_total: le(extrinsic, at + 104, 16),
  }
}

/// Prove the leaf at index `parent_number` under the bridge's root of `latest_height` leaves, bind the header to it, prove the extrinsic, and decode the digest.
pub fn verify_digest(
  mmr_root: ByteArray,
  latest_height: Int,
  proof: DigestProof,
) -> Digest {
  let DigestProof {
    leaf,
    items,
    header,
    extrinsic_index,
    trie_nodes,
    extrinsic,
  } = proof
  let leaf_hash = scale_encode_beefy_mmr_leaf(leaf) |> builtin.keccak_256
  expect
    verify_mmr_leaf(
      mmr_root,
      leaf_hash,
      leaf.parent_number,
      latest_height,
      items,
    )
  expect header_hash(header) == leaf.parent_hash
  expect header_number(header) == leaf.parent_number
  expect
    trie.verify(
      header_extrinsics_root(header),
      compact_encode(extrinsic_index),
      trie_nodes,
      extrinsic,
    )
  parse_rewards_call(extrinsic)
}

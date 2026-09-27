//// Test-side digest proof builder for `rewards/digest`: a six-leaf keccak
//// MMR whose leaf 4 commits to a synthetic SCALE header whose
//// `extrinsics_root` is a three-extrinsic trie with the rewards extrinsic
//// at index 1. Not imported by validators.

use aiken/builtin
use aiken/collection/list
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/types.{AuthoritySetCommitment, BeefyMmrLeaf} as bridge_types
use config
use rewards/digest.{header_hash}
use rewards/scale.{compact_encode}
use rewards/trie_builder.{build, proof, root}
use rewards/types.{Digest, DigestProof}

pub const rewards_index = 1

/// The bridge's `latest_height` for `digest_proof`: its MMR has six leaves.
pub const latest_height = 6

/// `(mmr_root, proof)` such that `verify_digest(mmr_root, latest_height, proof) == digest`.
pub fn digest_proof(digest: Digest) -> (ByteArray, DigestProof) {
  let n = 4
  let extrinsics = block_extrinsics(digest)
  let trie = build(extrinsics)
  let h =
    header(
      n,
      root(trie),
      [
        log_engine(#"06", "BABE", #"0102"),
        log_engine(#"04", "MNSV", #"01000000"),
      ],
    )
  let leaf =
    BeefyMmrLeaf {
      version: 0,
      parent_number: n,
      parent_hash: header_hash(h),
      next_authority_set: AuthoritySetCommitment(1, 1, fill(#"ee", 32)),
      extra: "",
    }
  let l4 = scale_encode_beefy_mmr_leaf(leaf) |> builtin.keccak_256
  let other =
    fn(i) { builtin.keccak_256(builtin.integer_to_bytearray(True, 1, i)) }
  let n6 = merge(merge(other(0), other(1)), merge(other(2), other(3)))
  let mmr_root = merge(merge(l4, other(5)), n6)
  expect Some(extrinsic) = list.at(extrinsics, rewards_index)
  (
    mmr_root,
    DigestProof {
      leaf,
      items: [n6, other(5)],
      header: h,
      extrinsic_index: rewards_index,
      trie_nodes: proof(trie, rewards_index),
      extrinsic,
    },
  )
}

/// A timestamp-like inherent, the rewards extrinsic, and a signed transaction.
pub fn block_extrinsics(digest: Digest) -> List<ByteArray> {
  [
    extrinsic(cat([#"05", #"0100", fill(#"77", 8)])),
    rewards_extrinsic(digest),
    extrinsic(cat([#"84", fill(#"aa", 100)])),
  ]
}

/// Bare `submit_rewards_digest` extrinsic (spec §7.1).
pub fn rewards_extrinsic(digest: Digest) -> ByteArray {
  extrinsic(
    cat(
      [
        #"05",
        builtin.integer_to_bytearray(True, 1, config.rewards_pallet_index),
        builtin.integer_to_bytearray(True, 1, config.rewards_call_index),
        u64(digest.epoch),
        u64(digest.leaf_count),
        digest.root,
        digest.min_key,
        digest.max_key,
        builtin.integer_to_bytearray(False, 16, digest.treasury_total),
      ],
    ),
  )
}

/// `Compact(len) || body`, as `UncheckedExtrinsic::encode`.
pub fn extrinsic(body: ByteArray) -> ByteArray {
  compact_encode(builtin.length_of_bytearray(body))
    |> builtin.append_bytearray(body)
}

pub fn header(
  number: Int,
  extrinsics_root: ByteArray,
  logs: List<ByteArray>,
) -> ByteArray {
  cat(
    [
      fill(#"11", 32),
      compact_encode(number),
      fill(#"22", 32),
      extrinsics_root,
      compact_encode(list.length(logs)),
      cat(logs),
    ],
  )
}

fn merge(left: ByteArray, right: ByteArray) -> ByteArray {
  builtin.append_bytearray(left, right) |> builtin.keccak_256
}

pub fn cat(parts: List<ByteArray>) -> ByteArray {
  list.foldr(parts, "", builtin.append_bytearray)
}

pub fn fill(byte: ByteArray, n: Int) -> ByteArray {
  cat(list.repeat(byte, n))
}

fn u64(n: Int) -> ByteArray {
  builtin.integer_to_bytearray(False, 8, n)
}

fn log_engine(tag: ByteArray, engine: ByteArray, bytes: ByteArray) -> ByteArray {
  cat([tag, engine, compact_encode(builtin.length_of_bytearray(bytes)), bytes])
}

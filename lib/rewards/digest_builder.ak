//// Test-side digest proof builder for `rewards/digest`: a six-leaf keccak
//// MMR whose leaf 4 commits to a synthetic SCALE header carrying the rewards
//// log at index 1. Not imported by validators.

use aiken/builtin
use aiken/collection/list
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/types.{AuthoritySetCommitment, BeefyMmrLeaf} as bridge_types
use rewards/digest.{header_hash}
use rewards/types.{Digest, DigestProof}

/// `(mmr_root, proof)` such that `verify_digest(mmr_root, proof) == digest`.
pub fn digest_proof(digest: Digest) -> (ByteArray, DigestProof) {
  let n = 4
  let h =
    header(
      n,
      [log_other(#"deadbeef"), log_engine(#"04", "MNRW", payload(digest))],
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
  let root = merge(merge(l4, other(5)), n6)
  (
    root,
    DigestProof {
      leaf,
      leaf_index: 4,
      leaf_count: 6,
      items: [n6, other(5)],
      header: h,
      log_index: 1,
    },
  )
}

fn payload(digest: Digest) -> ByteArray {
  cat(
    [
      #"01",
      u64(digest.epoch),
      u64(digest.leaf_count),
      digest.root,
      digest.min_key,
      digest.max_key,
    ],
  )
}

fn merge(left: ByteArray, right: ByteArray) -> ByteArray {
  builtin.append_bytearray(left, right) |> builtin.keccak_256
}

fn compact_enc(n: Int) -> ByteArray {
  if n < 64 {
    builtin.integer_to_bytearray(False, 1, n * 4)
  } else if n < 16384 {
    builtin.integer_to_bytearray(False, 2, n * 4 + 1)
  } else {
    builtin.integer_to_bytearray(False, 4, n * 4 + 2)
  }
}

fn cat(parts: List<ByteArray>) -> ByteArray {
  list.foldr(parts, "", builtin.append_bytearray)
}

fn fill(byte: ByteArray, n: Int) -> ByteArray {
  cat(list.repeat(byte, n))
}

fn u64(n: Int) -> ByteArray {
  builtin.integer_to_bytearray(False, 8, n)
}

fn log_other(bytes: ByteArray) -> ByteArray {
  cat([#"00", compact_enc(builtin.length_of_bytearray(bytes)), bytes])
}

fn log_engine(tag: ByteArray, engine: ByteArray, bytes: ByteArray) -> ByteArray {
  cat([tag, engine, compact_enc(builtin.length_of_bytearray(bytes)), bytes])
}

fn header(number: Int, logs: List<ByteArray>) -> ByteArray {
  cat(
    [
      fill(#"11", 32),
      compact_enc(number),
      fill(#"22", 32),
      fill(#"33", 32),
      compact_enc(list.length(logs)),
      cat(logs),
    ],
  )
}

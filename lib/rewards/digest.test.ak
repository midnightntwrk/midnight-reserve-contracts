use aiken/builtin
use aiken/collection/list
use bridge/types.{BeefyMmrLeaf} as bridge_types
use config
use rewards/digest.{
  header_extrinsics_root, header_number, parse_rewards_call, verify_digest,
}
use rewards/digest_builder.{
  block_extrinsics, digest_proof, extrinsic, fill, header, rewards_extrinsic,
  rewards_index,
}
use rewards/trie_builder.{build}
use rewards/types.{Digest, DigestProof}

fn digest(epoch: Int, leaf_count: Int) -> Digest {
  Digest {
    epoch,
    leaf_count,
    root: fill(#"aa", 32),
    min_key: fill(#"01", 28),
    max_key: fill(#"fe", 28),
  }
}

const xroot = fill(#"44", 32)

// Header parsing.

test header_number_small_and_large() {
  and {
    header_number(header(2, xroot, [])) == 2,
    header_number(header(70, xroot, [])) == 70,
    header_number(header(100000, xroot, [])) == 100000,
  }
}

test header_extrinsics_root_after_any_number_width() {
  and {
    header_extrinsics_root(header(2, xroot, [])) == xroot,
    header_extrinsics_root(header(70, xroot, [#"08"])) == xroot,
    header_extrinsics_root(header(100000, xroot, [#"08", #"08"])) == xroot,
  }
}

// Extrinsic decoding.

test parse_rewards_call_ok() {
  parse_rewards_call(rewards_extrinsic(digest(3, 7))) == digest(3, 7)
}

test parse_rewards_call_legacy_preamble_ok() {
  let xt = rewards_extrinsic(digest(3, 7))
  let legacy =
    builtin.slice_bytearray(0, 2, xt)
      |> builtin.append_bytearray(#"04")
      |> builtin.append_bytearray(builtin.slice_bytearray(3, 200, xt))
  parse_rewards_call(legacy) == digest(3, 7)
}

fn with_byte(xt: ByteArray, at: Int, byte: ByteArray) -> ByteArray {
  builtin.slice_bytearray(0, at, xt)
    |> builtin.append_bytearray(byte)
    |> builtin.append_bytearray(builtin.slice_bytearray(at + 1, 200, xt))
}

test parse_rewards_call_signed_preamble() fail {
  parse_rewards_call(with_byte(rewards_extrinsic(digest(3, 7)), 2, #"84")) == digest(
    3,
    7,
  )
}

test parse_rewards_call_wrong_pallet() fail {
  let wrong =
    builtin.integer_to_bytearray(True, 1, config.rewards_pallet_index + 1)
  parse_rewards_call(with_byte(rewards_extrinsic(digest(3, 7)), 3, wrong)) == digest(
    3,
    7,
  )
}

test parse_rewards_call_wrong_call() fail {
  let wrong =
    builtin.integer_to_bytearray(True, 1, config.rewards_call_index + 1)
  parse_rewards_call(with_byte(rewards_extrinsic(digest(3, 7)), 4, wrong)) == digest(
    3,
    7,
  )
}

test parse_rewards_call_trailing_byte() fail {
  let xt = builtin.append_bytearray(rewards_extrinsic(digest(3, 7)), #"00")
  parse_rewards_call(xt) == digest(3, 7)
}

test parse_rewards_call_short_body() fail {
  let body = builtin.slice_bytearray(2, 106, rewards_extrinsic(digest(3, 7)))
  parse_rewards_call(extrinsic(body)) == digest(3, 7)
}

test parse_rewards_call_other_extrinsic() fail {
  expect Some(other) = list.at(block_extrinsics(digest(3, 7)), 0)
  parse_rewards_call(other) == digest(3, 7)
}

// Full chain: MMR leaf, header, extrinsics trie, call.

test verify_digest_ok() {
  let (root, proof) = digest_proof(digest(3, 7))
  verify_digest(root, proof) == digest(3, 7)
}

test verify_digest_empty_epoch_ok() {
  let d = Digest { ..digest(9, 0), root: fill(#"00", 32) }
  let (root, proof) = digest_proof(d)
  verify_digest(root, proof) == d
}

test verify_digest_wrong_root() fail {
  let (_, proof) = digest_proof(digest(3, 7))
  verify_digest(fill(#"00", 32), proof) == digest(3, 7)
}

test verify_digest_mutated_header() fail {
  let (root, proof) = digest_proof(digest(3, 7))
  let h = with_byte(proof.header, 40, #"ff")
  verify_digest(root, DigestProof { ..proof, header: h }) == digest(3, 7)
}

test verify_digest_other_position() fail {
  let (root, proof) = digest_proof(digest(3, 7))
  verify_digest(root, DigestProof { ..proof, leaf_index: 3 }) == digest(3, 7)
}

test verify_digest_parent_number_mismatch() fail {
  let (root, proof) = digest_proof(digest(3, 7))
  let leaf = BeefyMmrLeaf { ..proof.leaf, parent_number: 5 }
  verify_digest(root, DigestProof { ..proof, leaf }) == digest(3, 7)
}

test verify_digest_other_extrinsic_index() fail {
  let (root, proof) = digest_proof(digest(3, 7))
  let xts = block_extrinsics(digest(3, 7))
  let trie = build(xts)
  expect Some(other) = list.at(xts, 0)
  verify_digest(
    root,
    DigestProof {
      ..proof,
      extrinsic_index: 0,
      trie_nodes: trie_builder.proof(trie, 0),
      extrinsic: other,
    },
  ) == digest(3, 7)
}

test verify_digest_index_without_matching_proof() fail {
  let (root, proof) = digest_proof(digest(3, 7))
  verify_digest(root, DigestProof { ..proof, extrinsic_index: 2 }) == digest(
    3,
    7,
  )
}

test verify_digest_tampered_extrinsic() fail {
  let (root, proof) = digest_proof(digest(3, 7))
  let forged = rewards_extrinsic(digest(4, 7))
  verify_digest(root, DigestProof { ..proof, extrinsic: forged }) == digest(
    4,
    7,
  )
}

test verify_digest_foreign_trie_nodes() fail {
  let (root, proof) = digest_proof(digest(3, 7))
  let other_trie = build(block_extrinsics(digest(4, 7)))
  verify_digest(
    root,
    DigestProof {
      ..proof,
      trie_nodes: trie_builder.proof(other_trie, rewards_index),
    },
  ) == digest(3, 7)
}

test verify_digest_without_trie_nodes() fail {
  let (root, proof) = digest_proof(digest(3, 7))
  verify_digest(root, DigestProof { ..proof, trie_nodes: [] }) == digest(3, 7)
}

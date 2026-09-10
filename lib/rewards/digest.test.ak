use aiken/builtin
use aiken/collection/list
use bridge/codec.{scale_encode_beefy_mmr_leaf}
use bridge/types.{AuthoritySetCommitment, BeefyMmrLeaf} as bridge_types
use rewards/digest.{
  header_digest_log, header_hash, header_number, parse_rewards_digest,
  verify_digest,
}
use rewards/types.{Digest, DigestProof}

// Synthetic SCALE header builder.

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

fn u64(n: Int) -> ByteArray {
  builtin.integer_to_bytearray(False, 8, n)
}

fn payload(epoch: Int, leaf_count: Int) -> ByteArray {
  cat(
    [
      #"01",
      u64(epoch),
      u64(leaf_count),
      fill(#"aa", 32),
      fill(#"01", 28),
      fill(#"fe", 28),
    ],
  )
}

fn digest(epoch: Int, leaf_count: Int) -> Digest {
  Digest {
    epoch,
    leaf_count,
    root: fill(#"aa", 32),
    min_key: fill(#"01", 28),
    max_key: fill(#"fe", 28),
  }
}

const engine = "MNRW"

fn logs(epoch: Int) -> List<ByteArray> {
  [
    log_engine(#"06", "BABE", #"0102"),
    log_engine(#"04", engine, payload(epoch, 7)),
    log_engine(#"05", "BABE", fill(#"55", 64)),
    log_other(#"deadbeef"),
    #"08",
  ]
}

fn read(h: ByteArray, i: Int) -> (Int, ByteArray, ByteArray) {
  let tag, engine, bytes <- header_digest_log(h, i)
  (tag, engine, bytes)
}

// Header parsing.

test header_number_small_and_large() {
  and {
    header_number(header(2, [])) == 2,
    header_number(header(70, [])) == 70,
    header_number(header(100000, [])) == 100000,
  }
}

test header_logs_by_index() {
  let h = header(9, logs(3))
  and {
    read(h, 0) == (6, "BABE", #"0102"),
    read(h, 1) == (4, engine, payload(3, 7)),
    read(h, 2) == (5, "BABE", fill(#"55", 64)),
    read(h, 3) == (0, "", #"deadbeef"),
    read(h, 4) == (8, "", ""),
  }
}

test header_log_after_long_other() {
  let h =
    header(
      9,
      [log_other(fill(#"77", 200)), log_engine(#"04", engine, payload(1, 0))],
    )
  read(h, 1) == (4, engine, payload(1, 0))
}

test header_log_index_out_of_range() fail {
  read(header(9, logs(3)), 5) == (8, "", "")
}

test header_log_negative_index() fail {
  read(header(9, logs(3)), -1) == (8, "", "")
}

test header_unknown_tag_rejected() fail {
  read(header(9, [#"07"]), 0) == (7, "", "")
}

test header_unknown_tag_while_skipping_rejected() fail {
  read(header(9, [#"07", #"08"]), 1) == (8, "", "")
}

test header_hash_is_blake2b_256() {
  let h = header(9, logs(3))
  header_hash(h) == builtin.blake2b_256(h)
}

// Payload.

test parse_payload() {
  parse_rewards_digest(engine, payload(5, 7)) == digest(5, 7)
}

test parse_payload_empty_epoch() {
  let p =
    cat(
      [#"01", u64(5), u64(0), fill(#"00", 32), fill(#"00", 28), fill(#"00", 28)],
    )
  parse_rewards_digest(engine, p) == Digest {
    epoch: 5,
    leaf_count: 0,
    root: fill(#"00", 32),
    min_key: fill(#"00", 28),
    max_key: fill(#"00", 28),
  }
}

test parse_payload_wrong_engine() fail {
  parse_rewards_digest("MNSV", payload(5, 7)) == digest(5, 7)
}

test parse_payload_short() fail {
  parse_rewards_digest(engine, builtin.slice_bytearray(0, 104, payload(5, 7))) == digest(
    5,
    7,
  )
}

test parse_payload_long() fail {
  parse_rewards_digest(engine, builtin.append_bytearray(payload(5, 7), #"00")) == digest(
    5,
    7,
  )
}

test parse_payload_wrong_variant() fail {
  let p =
    builtin.append_bytearray(
      #"00",
      builtin.slice_bytearray(1, 104, payload(5, 7)),
    )
  parse_rewards_digest(engine, p) == digest(5, 7)
}

// End to end: leaf 4 of a 6-leaf MMR is the BEEFY leaf for block N + 1,
// whose parent is header N with the rewards log at index 1. The MMR is
// built by hand: leaves at positions 0 1 3 4 7 8, peaks at 6 and 9.

fn merge(left: ByteArray, right: ByteArray) -> ByteArray {
  builtin.append_bytearray(left, right) |> builtin.keccak_256
}

fn fixture() -> (ByteArray, DigestProof) {
  let n = 4
  let h = header(n, logs(3))
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
  let n2 = merge(other(0), other(1))
  let n5 = merge(other(2), other(3))
  let n6 = merge(n2, n5)
  let n9 = merge(l4, other(5))
  let root = merge(n9, n6)
  let items = [n6, other(5)]
  (
    root,
    DigestProof {
      leaf,
      leaf_index: 4,
      leaf_count: 6,
      items,
      header: h,
      log_index: 1,
    },
  )
}

test verify_digest_ok() {
  let (root, proof) = fixture()
  verify_digest(root, proof) == digest(3, 7)
}

test verify_digest_wrong_root() fail {
  let (_, proof) = fixture()
  verify_digest(fill(#"00", 32), proof) == digest(3, 7)
}

test verify_digest_mutated_header() fail {
  let (root, proof) = fixture()
  let h =
    builtin.append_bytearray(
      builtin.slice_bytearray(0, 40, proof.header),
      builtin.append_bytearray(
        #"ff",
        builtin.slice_bytearray(41, 1000, proof.header),
      ),
    )
  verify_digest(root, DigestProof { ..proof, header: h }) == digest(3, 7)
}

test verify_digest_wrong_log_index() fail {
  let (root, proof) = fixture()
  verify_digest(root, DigestProof { ..proof, log_index: 0 }) == digest(3, 7)
}

test verify_digest_other_position() fail {
  let (root, proof) = fixture()
  verify_digest(root, DigestProof { ..proof, leaf_index: 3 }) == digest(3, 7)
}

test verify_digest_parent_number_mismatch() fail {
  let (root, proof) = fixture()
  let leaf = BeefyMmrLeaf { ..proof.leaf, parent_number: 5 }
  verify_digest(root, DigestProof { ..proof, leaf }) == digest(3, 7)
}

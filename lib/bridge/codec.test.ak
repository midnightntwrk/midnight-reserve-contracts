use aiken/builtin
use aiken/collection/list
use bridge/codec.{scale_encode_bytes, scale_encode_commitment}
use bridge/types.{Commitment, Payload}

const root = #"4f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998a"

// Commitment shape.

test commitment_no_payloads() {
  scale_encode_commitment(Commitment([], 1, 2)) == #"00010000000200000000000000"
}

test commitment_two_payloads_in_order() {
  scale_encode_commitment(
    Commitment([Payload("mh", root), Payload("ab", #"0102")], 185, 0),
  ) == #"086d68804f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998a6162080102b90000000000000000000000"
}

test commitment_order_matters() {
  scale_encode_commitment(
    Commitment([Payload("mh", root), Payload("ab", #"0102")], 185, 0),
  ) != scale_encode_commitment(
    Commitment([Payload("ab", #"0102"), Payload("mh", root)], 185, 0),
  )
}

test commitment_u32_max_block_and_wide_set_id() {
  scale_encode_commitment(
    Commitment([Payload("mh", "")], 4294967295, 1099511627777),
  ) == #"046d6800ffffffff0100000000010000"
}

/// 64 payloads push the count into the two-byte compact mode.
test commitment_64_payloads() {
  let payloads = list.map(list.range(1, 64), fn(_) { Payload("id", "") })
  let encoded = scale_encode_commitment(Commitment(payloads, 7, 9))
  and {
    builtin.slice_bytearray(0, 2, encoded) == #"0101",
    builtin.length_of_bytearray(encoded) == 206,
    builtin.slice_bytearray(194, 12, encoded) == #"070000000900000000000000",
  }
}

// Compact length prefix through scale_encode_bytes (one- and two-byte modes).

fn prefix(len: Int) -> ByteArray {
  let encoded = scale_encode_bytes(builtin.replicate_byte(len, 0xaa))
  builtin.slice_bytearray(
    0,
    builtin.length_of_bytearray(encoded) - len,
    encoded,
  )
}

test bytes_empty() {
  scale_encode_bytes("") == #"00"
}

test bytes_prefix_modes() {
  and {
    prefix(1) == #"04",
    prefix(63) == #"fc",
    prefix(64) == #"0101",
  }
}

test bytes_keeps_body() {
  let body = builtin.replicate_byte(64, 0x5a)
  scale_encode_bytes(body) == builtin.append_bytearray(#"0101", body)
}

//// SCALE compact-integer decoding (spec §7.1). Modes from the low two bits
//// of the first byte: `00` one byte, `01` two bytes LE, `10` four bytes
//// LE (value = raw >> 2), `11` big-int with `(first >> 2) + 4` LE bytes.

use aiken/builtin
use aiken/collection/list

/// Decode the compact integer at `at`; continues with `(value, next_offset)`.
pub fn compact(bytes: ByteArray, at: Int, callback: fn(Int, Int) -> r) -> r {
  let first = builtin.index_bytearray(bytes, at)
  when first % 4 is {
    0 -> callback(first / 4, at + 1)
    1 -> callback(le(bytes, at, 2) / 4, at + 2)
    2 -> callback(le(bytes, at, 4) / 4, at + 4)
    _ -> {
      let len = first / 4 + 4
      callback(le(bytes, at + 1, len), at + 1 + len)
    }
  }
}

/// SCALE compact encoding of `n < 2^30`.
pub fn compact_encode(n: Int) -> ByteArray {
  if n < 64 {
    builtin.integer_to_bytearray(False, 1, n * 4)
  } else if n < 16384 {
    builtin.integer_to_bytearray(False, 2, n * 4 + 1)
  } else {
    expect n < 1073741824
    builtin.integer_to_bytearray(False, 4, n * 4 + 2)
  }
}

/// Little-endian unsigned integer of `len` bytes at `at`.
pub fn le(bytes: ByteArray, at: Int, len: Int) -> Int {
  builtin.slice_bytearray(at, len, bytes)
    |> builtin.bytearray_to_integer(False, _)
}

fn decode(bytes: ByteArray) -> (Int, Int) {
  let value, next <- compact(bytes, 0)
  (value, next)
}

test compact_single_byte() {
  and {
    decode(#"00") == (0, 1),
    decode(#"04") == (1, 1),
    decode(#"fc") == (63, 1),
  }
}

test compact_two_bytes() {
  and {
    decode(#"0101") == (64, 2),
    decode(#"fdff") == (16383, 2),
  }
}

test compact_four_bytes() {
  and {
    decode(#"02000100") == (16384, 4),
    decode(#"feffffff") == (1073741823, 4),
  }
}

test compact_big_int() {
  and {
    decode(#"0300000040") == (1073741824, 5),
    decode(#"070000000001") == (4294967296, 6),
    decode(#"0b000000000001") == (1099511627776, 7),
  }
}

test compact_at_offset() {
  let value, next <- compact(#"ffff0101", 2)
  value == 64 && next == 4
}

test compact_encode_roundtrip() {
  list.all(
    [0, 1, 63, 64, 107, 16383, 16384, 1073741823],
    fn(n) {
      decode(compact_encode(n)) == (
        n,
        builtin.length_of_bytearray(compact_encode(n)),
      )
    },
  )
}

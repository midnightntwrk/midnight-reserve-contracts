use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use bridge/types.{BeefyMmrLeaf, Commitment, Payload}

pub fn scale_encode_commitment(commitment: Commitment) -> ByteArray {
  let Commitment { payloads, block_number, validator_set_id } = commitment

  let payload_bytes =
    list.foldl(
      payloads,
      "",
      fn(x: Payload, acc: ByteArray) -> ByteArray {
        let Payload { id, data } = x

        let scale_encode_payload =
          bytearray.concat(id, scale_encode_bytes(data))

        bytearray.concat(acc, scale_encode_payload)
      },
    )

  let payload_encoded = scale_encode_bytes(payload_bytes)

  let rest =
    builtin.integer_to_bytearray(False, 4, block_number)
      |> bytearray.concat(
          builtin.integer_to_bytearray(False, 8, validator_set_id),
        )

  bytearray.concat(payload_encoded, rest)
}

pub fn scale_encode_beefy_mmr_leaf(leaf: BeefyMmrLeaf) -> ByteArray {
  let BeefyMmrLeaf {
    version,
    parent_number,
    parent_hash,
    next_authority_set,
    extra,
    ..
  } = leaf

  let first =
    builtin.integer_to_bytearray(False, 1, version)
      |> bytearray.concat(builtin.integer_to_bytearray(False, 4, parent_number))

  let second =
    parent_hash
      |> bytearray.concat(
          builtin.integer_to_bytearray(False, 8, next_authority_set.id),
        )

  let third =
    builtin.integer_to_bytearray(False, 4, next_authority_set.len)
      |> bytearray.concat(next_authority_set.root)

  first
    |> bytearray.concat(second)
    |> bytearray.concat(third)
    |> bytearray.concat(extra)
}

pub const scale_mode = [#"00", #"01", #"02", #"03"]

pub fn scale_encode_bytes(data: ByteArray) -> ByteArray {
  let length = builtin.length_of_bytearray(data)

  let length_encoded =
    if length < 64 {
      builtin.integer_to_bytearray(False, 1, length)
        |> builtin.shift_bytearray(2)
    } else if length < 16384 {
      builtin.or_bytearray(
        True,
        builtin.integer_to_bytearray(False, 2, length)
          |> builtin.shift_bytearray(2),
        #"01",
      )
    } else if length < 1_073_741_824 {
      builtin.or_bytearray(
        True,
        builtin.integer_to_bytearray(False, 4, length)
          |> builtin.shift_bytearray(2),
        #"02",
      )
    } else {
      // Using 0 gets the exact byte length to store the integer
      // No extra padding to strip off
      let length_bytes = builtin.integer_to_bytearray(False, 0, length)
      let length_of_length = builtin.length_of_bytearray(length_bytes)

      let prefix =
        builtin.or_bytearray(
          True,
          builtin.integer_to_bytearray(False, 1, length_of_length - 4)
            |> builtin.shift_bytearray(2),
          #"03",
        )

      bytearray.concat(prefix, length_bytes)
    }

  bytearray.concat(length_encoded, data)
}

/// This is actually unneeded
/// In solidity they have to pad bytes to u64, u128, or u256
/// to little endian encode an integer. In Plutus
/// we can simply generate an exact size bytearray
/// in either little or big endian of the integer.
/// Thus we don't pad extra zeros that need to be stripped off
/// This is just for reference on how you would do that
pub fn remove_ending_zeros(b: ByteArray) -> ByteArray {
  let last_set_bit = builtin.find_first_set_bit(b)

  let last_byte = last_set_bit + 7 / 8

  builtin.slice_bytearray(0, last_byte, b)
}

use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use bridge/types.{AuthoritySetCommitment, BeefyMmrLeaf, Commitment, Payload}

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

  let payload_encoded =
    scale_encode_length(list.length(payloads))
      |> bytearray.concat(payload_bytes)

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
    |> bytearray.concat(
        if extra == "" {
          #"00"
        } else {
          extra
        },
      )
}

pub const scale_mode = [#"00", #"01", #"02", #"03"]

fn scale_encode_length(length: Int) {
  let length_encoded =
    if length < 64 {
      builtin.integer_to_bytearray(False, 1, length * 4)
    } else if length < 16384 {
      builtin.integer_to_bytearray(False, 2, length * 4 + 1)
    } else if length < 1_073_741_824 {
      builtin.integer_to_bytearray(False, 4, length * 4 + 2)
    } else {
      // Using 0 gets the exact byte length to store the integer
      // No extra padding to strip off
      let length_bytes = builtin.integer_to_bytearray(False, 0, length)
      let length_of_length = builtin.length_of_bytearray(length_bytes)

      let prefix =
        builtin.integer_to_bytearray(False, 1, ( length_of_length - 4 ) * 4 + 3)

      bytearray.concat(prefix, length_bytes)
    }

  length_encoded
}

pub fn scale_encode_bytes(data: ByteArray) -> ByteArray {
  let length = builtin.length_of_bytearray(data)

  scale_encode_length(length) |> bytearray.concat(data)
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

// SignedCommitment {
//     commitment: Commitment {
//         payload: Payload(
//             [
//                 (
//                     [
//                         109,
//                         104,
//                     ],
//                     [
//                         53,
//                         65,
//                         254,
//                         123,
//                         27,
//                         186,
//                         127,
//                         141,
//                         229,
//                         210,
//                         46,
//                         204,
//                         239,
//                         0,
//                         80,
//                         219,
//                         105,
//                         225,
//                         203,
//                         189,
//                         175,
//                         186,
//                         97,
//                         188,
//                         180,
//                         234,
//                         162,
//                         244,
//                         237,
//                         247,
//                         111,
//                         152,
//                     ],
//                 ),
//             ],
//         ),
//         block_number: 665,
//         validator_set_id: 0,
//     },
//     signatures: [
//         Some(
//             Signature(
//                 a43cd5ab202cfb127d8cf74f68b05c0db0e9b030b1f1bb89a3c272e5c0762a1a7ac67e71538de8033ef8d566657f1f47c0456cf1371982ff08ced25f53eaf80000,
//             ),
//         ),
//     ],
// }

const comm =
  Commitment(
    [
      Payload(
        #[109, 104],
        #[
          79,
          42,
          251,
          147,
          130,
          143,
          102,
          40,
          32,
          255,
          188,
          69,
          86,
          105,
          27,
          101,
          117,
          37,
          249,
          209,
          30,
          101,
          14,
          4,
          231,
          189,
          125,
          5,
          76,
          64,
          153,
          138,
        ],
      ),
    ],
    185,
    0,
  )

test scale_encode_commitment_1() {
  scale_encode_commitment(comm) == #"046d68804f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998ab90000000000000000000000"
}

test scale_encode_beefy_leaf_1() {
  let beefy_leaf =
    BeefyMmrLeaf {
      version: 0,
      parent_number: 273,
      parent_hash: #"c773b67e92868f58aef6874146464646331be113fba51bd89a48d65b6d81bf3d",
      next_authority_set: AuthoritySetCommitment(
        1,
        1,
        #"ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
      ),
      extra: "",
      k_index: 273,
      leaf_index: 273,
    }

  let codec_leaf = scale_encode_beefy_mmr_leaf(beefy_leaf)

  codec_leaf == #"0011010000c773b67e92868f58aef6874146464646331be113fba51bd89a48d65b6d81bf3d010000000000000001000000ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d00"
}

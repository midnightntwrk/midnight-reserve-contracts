use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use bridge/types.{AuthoritySetCommitment, BeefyMmrLeaf, Commitment, Payload}

/// SCALE-encode a BEEFY `Commitment` into the exact byte sequence that
/// the relay chain signs. Layout:
///   `scale_encode_length(len(payloads))` ||
///     for each payload: `id || scale_encode_bytes(data)` ||
///   little-endian u32 block_number ||
///   little-endian u64 validator_set_id
/// The keccak256 of this byte string is the message each validator signs.
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

/// SCALE-encode a `BeefyMmrLeaf` into the byte sequence whose keccak256
/// hash equals the `"nc"` payload in the signed commitment. Layout:
///   u8 version ||
///   little-endian u32 parent_number ||
///   parent_hash (32 bytes) ||
///   little-endian u64 next_authority_set.id ||
///   little-endian u32 next_authority_set.len ||
///   next_authority_set.root (32 bytes) ||
///   extra (or a single 0x00 byte when `extra` is empty)
pub fn scale_encode_beefy_mmr_leaf(leaf: BeefyMmrLeaf) -> ByteArray {
  let BeefyMmrLeaf {
    version,
    parent_number,
    parent_hash,
    next_authority_set,
    extra,
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

/// SCALE compact-integer length prefix. The two low bits of the first
/// byte select one of four length modes (see Substrate SCALE compact
/// integer encoding):
///   `0x00` — single-byte compact; value in the upper 6 bits; values `<= 63`.
///   `0x01` — two-byte compact; value in the upper 14 bits; values `<= 16383`.
///   `0x02` — four-byte compact; value in the upper 30 bits; values `< 2^30`.
///   `0x03` — big-integer compact; upper 6 bits of the prefix hold
///            `length_of_value_bytes - 4`, followed by the raw bytes.
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

/// SCALE-encode a length-prefixed byte array: emits the compact length
/// followed by the raw bytes.
pub fn scale_encode_bytes(data: ByteArray) -> ByteArray {
  let length = builtin.length_of_bytearray(data)

  scale_encode_length(length) |> bytearray.concat(data)
}

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

// Vector: single-payload commitment with id "mh" (the MMR-root tag),
// block_number 185, validator_set_id 0.
test scale_encode_commitment_1() {
  scale_encode_commitment(comm) == #"046d68804f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998ab90000000000000000000000"
}

// Vector: MMR leaf advancing parent_number=273 with a non-zero
// next_authority_set and empty `extra` (encoded as a single 0x00 byte).
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
    }

  let codec_leaf = scale_encode_beefy_mmr_leaf(beefy_leaf)

  codec_leaf == #"0011010000c773b67e92868f58aef6874146464646331be113fba51bd89a48d65b6d81bf3d010000000000000001000000ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d00"
}

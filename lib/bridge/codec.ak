//// SCALE encodings the bridge re-derives on chain: the 48-byte signed
//// commitment and the 82-byte MMR leaf. Both are raw concatenations of
//// fixed-width fields, so the 32-byte guards are what make them injective.

use aiken/builtin
use aiken/primitive/bytearray
use bridge/types.{AuthoritySetCommitment, BeefyMmrLeaf}

/// SCALE payload list prefix: one payload, id `"mh"`, compact length 32.
const commitment_prefix = #"046d6880"

/// Encode the 48 signed bytes: `04 6d68 80 ‖ mmr_root ‖ block_number (u32 LE) ‖ validator_set_id (u64 LE)`.
pub fn scale_encode_commitment(
  mmr_root: ByteArray,
  block_number: Int,
  validator_set_id: Int,
) -> ByteArray {
  expect builtin.length_of_bytearray(mmr_root) == 32

  commitment_prefix
    |> bytearray.concat(mmr_root)
    |> bytearray.concat(builtin.integer_to_bytearray(False, 4, block_number))
    |> bytearray.concat(
        builtin.integer_to_bytearray(False, 8, validator_set_id),
      )
}

/// Encode the 82 leaf bytes: `version ‖ parent_number (u32 LE) ‖ parent_hash ‖ validator_set_id (u64 LE) ‖ seat_count (u32 LE) ‖ keyset_commitment ‖ 00`.
pub fn scale_encode_beefy_mmr_leaf(leaf: BeefyMmrLeaf) -> ByteArray {
  let BeefyMmrLeaf {
    version,
    parent_number,
    parent_hash,
    next_authority_set,
    extra,
  } = leaf

  let AuthoritySetCommitment { validator_set_id, seat_count, keyset_commitment } =
    next_authority_set

  expect version == 0
  expect builtin.length_of_bytearray(parent_hash) == 32
  expect builtin.length_of_bytearray(keyset_commitment) == 32
  expect extra == ""

  builtin.integer_to_bytearray(False, 1, version)
    |> bytearray.concat(builtin.integer_to_bytearray(False, 4, parent_number))
    |> bytearray.concat(parent_hash)
    |> bytearray.concat(
        builtin.integer_to_bytearray(False, 8, validator_set_id),
      )
    |> bytearray.concat(builtin.integer_to_bytearray(False, 4, seat_count))
    |> bytearray.concat(keyset_commitment)
    |> bytearray.concat(#"00")
}

// MIP §Test vectors, Signed bytes.
test scale_encode_commitment_mip_vector() {
  scale_encode_commitment(
    #"0000000000000000000000000000000000000000000000000000000000000000",
    1,
    0,
  ) == #"046d68800000000000000000000000000000000000000000000000000000000000000000010000000000000000000000"
}

// Vector: block_number 185, validator_set_id 0.
test scale_encode_commitment_1() {
  scale_encode_commitment(
    #"4f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998a",
    185,
    0,
  ) == #"046d68804f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998ab90000000000000000000000"
}

test commitment_rejects_short_root() fail {
  scale_encode_commitment(
    #"4f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c4099",
    185,
    0,
  ) != ""
}

// MIP §Test vectors, Leaf layout: version 0, parent_number 600, commitment (1, 4, root), empty extra.
test scale_encode_beefy_leaf_mip_layout() {
  scale_encode_beefy_mmr_leaf(
    BeefyMmrLeaf {
      version: 0,
      parent_number: 600,
      parent_hash: #"9b9462bf599ab609ea9917918e6b69b54b2bff8b7be6fc0de8984b55f5fbb057",
      next_authority_set: AuthoritySetCommitment(
        1,
        4,
        #"ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
      ),
      extra: "",
    },
  ) == #"00580200009b9462bf599ab609ea9917918e6b69b54b2bff8b7be6fc0de8984b55f5fbb057010000000000000004000000ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d00"
}

// Vector: parent_number 273, commitment (1, 1, root), empty extra.
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

  scale_encode_beefy_mmr_leaf(beefy_leaf) == #"0011010000c773b67e92868f58aef6874146464646331be113fba51bd89a48d65b6d81bf3d010000000000000001000000ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d00"
}

test commitment_rejects_block_number_overflow() fail {
  scale_encode_commitment(
    #"4f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998a",
    4_294_967_296,
    0,
  ) != ""
}

test commitment_rejects_set_id_overflow() fail {
  scale_encode_commitment(
    #"4f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998a",
    185,
    18_446_744_073_709_551_616,
  ) != ""
}

test commitment_rejects_negative_block_number() fail {
  scale_encode_commitment(
    #"4f2afb93828f662820ffbc4556691b657525f9d11e650e04e7bd7d054c40998a",
    -1,
    0,
  ) != ""
}

// Width guards. The fields are concatenated with no delimiters, so a short
// `parent_hash` or `keyset_commitment` would let the fixed-width fields after
// it slide and one byte string parse as several leaves. Each test below
// trips exactly the guard it names; every other field is valid.

test leaf_encoding_rejects_nonzero_version() fail {
  scale_encode_beefy_mmr_leaf(
    BeefyMmrLeaf {
      version: 1,
      parent_number: 273,
      parent_hash: #"c773b67e92868f58aef6874146464646331be113fba51bd89a48d65b6d81bf3d",
      next_authority_set: AuthoritySetCommitment(
        1,
        1,
        #"ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
      ),
      extra: "",
    },
  ) != ""
}

test leaf_encoding_rejects_empty_root() fail {
  scale_encode_beefy_mmr_leaf(
    BeefyMmrLeaf {
      version: 0,
      parent_number: 273,
      parent_hash: #"c773b67e92868f58aef6874146464646331be113fba51bd89a48d65b6d81bf3d",
      next_authority_set: AuthoritySetCommitment(1, 1, ""),
      extra: "",
    },
  ) != ""
}

test leaf_encoding_rejects_short_parent_hash() fail {
  scale_encode_beefy_mmr_leaf(
    BeefyMmrLeaf {
      version: 0,
      parent_number: 273,
      parent_hash: #"c773b67e92868f58aef6874146464646331be113fba51bd89a48d65b6d81bf",
      next_authority_set: AuthoritySetCommitment(
        1,
        1,
        #"ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
      ),
      extra: "",
    },
  ) != ""
}

test leaf_encoding_rejects_extra() fail {
  scale_encode_beefy_mmr_leaf(
    BeefyMmrLeaf {
      version: 0,
      parent_number: 273,
      parent_hash: #"c773b67e92868f58aef6874146464646331be113fba51bd89a48d65b6d81bf3d",
      next_authority_set: AuthoritySetCommitment(
        1,
        1,
        #"ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
      ),
      extra: #"00",
    },
  ) != ""
}

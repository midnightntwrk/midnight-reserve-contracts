use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use bridge/beefy.{check_auth_sigs_and_get_len}
use bridge/beefy_example.{leaves, validator_set}
use bridge/types.{Vote}

const msg =
  #"046d688031a1569c05fd4d8e3988580b3ad2073d6a1efc12eabf9b1dd33861bf086ea635990100000000000000000000"

const signatures =
  [
    None,
    Some(
      #"79475984d45695729e9a0347f7c8abb7498f5ffb48e667740a8b18e6c3644ad53dcd4ec826479de5d176f46a95c34dc423605c6b21939c006b09e10b7896ed8d00",
    ),
    Some(
      #"d6280dd328f7595280b0f23bb5a007429694ef70e4e23cceb50a7c3befd3d920105b5d4aabace45022d88b114986cf8f84c8b9be70c7a4c0e05bfac2f44d414801",
    ),
    None,
    Some(
      #"3f6b97738f348874fe59fa46b0731dfcdbf0ff88efdd9d094448381aad317c7b5b2cb1c14a4920c69ede0d83347b899b00ca8705948660f04f74cb76147cfc3401",
    ),
    Some(
      #"b8e5a339011b0ba26fc0ac965d7ab4d8bc394f359784df1bedad6a44952c1cff72fcd4cf76be13658e357c78e275632c2b3e0e060a1ddecf6d45b7aa968e7f3200",
    ),
    Some(
      #"998f9f5e05fcc6b0f581eff6bba32b9928fc6bf3753b159e43f11469932905215314d3a0611da8c830bb6528ea3434ebcd2b1ff87de79eb32fbb3512814a892201",
    ),
    Some(
      #"f678467dcddd6c154e0c1cf7719671a801b12e2e7d96d5df1aa0e357d25a8c837f87bfa8c21f36f4ff16253bd3fbe3ebd6fb526f3653b6cb1eca0ae28cf6da0401",
    ),
    Some(
      #"9a609794b8743a7fe1ac5df9c0ca03b4037b07be4dcfe02b62837a9b17df2bd21361b2ff027339c6678e09bffd1f9aa1f8fec24f9567be638d8377b3b88564da00",
    ),
    Some(
      #"fc182e0a7a405f19360cb3a1941cfef8b2dde3f3e4ec19dcaee0611efe3cca6535a2c771f765a70dee2e045f74f582ac16976671b9682dbdae998330d0c3d6f701",
    ),
    None,
    Some(
      #"76ebd8e01d70ff7a71b18949cfef4a7fd507a902b480f360c4b1b36f406c0d756f1c39d264f9cef8bb241738905341a8b4775eef6bab8ee44452e30783cf10ee01",
    ),
  ]

const votes =
  list.zip(validator_set, signatures)
    |> list.indexed_map(
        fn(i, x) {
          if x.2nd == None {
            None
          } else {
            let (key, sig) = x
            expect Some(sig) = sig
            let sig = bytearray.take(sig, 64)
            Some(Vote(sig, i, key))
          }
        },
      )
    |> list.filter_map(identity)

fn at(l: List<a>, index: Int) -> a {
  expect [item, ..rest] = l

  if index == 0 {
    item
  } else {
    at(rest, index - 1)
  }
}

test beefy_candidate_sig() {
  let i = check_auth_sigs_and_get_len(leaves, votes, msg |> builtin.keccak_256)

  i == 9
}

test single_sig_check() {
  expect Some(sig) = at(signatures, 1)
  let sig = bytearray.take(sig, 64)

  let msg_hash = msg |> builtin.keccak_256

  builtin.verify_ecdsa_secp256k1_signature(at(validator_set, 1), msg_hash, sig)
}

test other() {
  let msg = #"0fde9e2d2862fe7c4a38d29f479dfb96c3e230893a23d8ccc2189d3169b47099"
  let sig1 =
    #"d31442fe8f856d2fde9367cfe45703b61a4046146d9a637a939dd6b99ba64753668ddc45f3fb4438388d27c0e226f0fc6897e79dac89eb2c58b9c4be5eb18a0b"

  let pubkey1 =
    #"c12f0cb1ab46ee09fe775a082b4b69ab0e8e8eddd72b7ca8c7b40514f1811ca6"

  let sig2 =
    #"f9d65b7c723403d721f57ff6d9eec81aebece11a23eade69f5d2e0d9266c42705dd986680f41749932acdd4b19f6b50ce61b723ee03187ec270e3dce39a71e01"

  let pubkey2 =
    #"d9ccaf846d3f2db7e95fdc1be44a82db5f0d116b999e7e5411f3c0bf07e186db"

  let thing = builtin.verify_ed25519_signature(pubkey1, msg, sig1)

  let thing2 = builtin.verify_ed25519_signature(pubkey2, msg, sig2)

  thing && thing2
}

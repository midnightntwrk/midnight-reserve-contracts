use aiken/builtin
use bridge/codec.{scale_encode_commitment}
use bridge/merkle.{verify_merkle_multi_proof_get_leaves, verify_mmr_leaf}
use bridge/types.{BeefyConsensusState, BeefyThreshold, BridgeUpdate, Leaf}

/// Verify `update` against `trusted_state` and require the derived state to equal `out_state`.
pub fn verify_consensus(
  trusted_state: BeefyConsensusState,
  update: BridgeUpdate,
  threshold: BeefyThreshold,
  out_state: BeefyConsensusState,
) -> Bool {
  verify_mmr_update_proof(trusted_state, update, threshold) == out_state
}

/// Derive the next `BeefyConsensusState` from `update`; any failed check aborts the script.
pub fn verify_mmr_update_proof(
  trusted_state: BeefyConsensusState,
  update: BridgeUpdate,
  threshold: BeefyThreshold,
) -> BeefyConsensusState {
  let BeefyConsensusState {
    latest_height,
    beefy_activation_block,
    current_committee,
    next_committee,
    ..
  } = trusted_state

  let BridgeUpdate {
    mmr_root,
    block_number,
    validator_set_id,
    signatures,
    leaf,
    mmr_proof,
    multiproof,
  } = update

  let BeefyThreshold { numerator, denominator, .. } = threshold

  let threshold_fn =
    fn(seats) { ( seats * numerator + denominator - 1 ) / denominator }

  expect latest_height < block_number

  let validating_root, validating_threshold <-
    fn(callback) {
      if validator_set_id == current_committee.validator_set_id {
        callback(
          current_committee.keyset_commitment,
          threshold_fn(current_committee.seat_count),
        )
      } else {
        expect validator_set_id == next_committee.validator_set_id
        callback(
          next_committee.keyset_commitment,
          threshold_fn(next_committee.seat_count),
        )
      }
    }

  let leaves =
    verify_merkle_multi_proof_get_leaves(
      validating_root,
      multiproof |> builtin.un_list_data,
    )

  let signed_seats =
    check_auth_sigs_and_sum_seats(
      leaves,
      signatures,
      scale_encode_commitment(mmr_root, block_number, validator_set_id)
        |> builtin.keccak_256,
    )

  expect signed_seats >= validating_threshold

  expect verify_mmr_leaf(leaf, mmr_proof, mmr_root)

  let current_committee, next_committee <-
    fn(callback) {
      if leaf.next_authority_set.validator_set_id > next_committee.validator_set_id {
        callback(next_committee, leaf.next_authority_set)
      } else {
        callback(current_committee, next_committee)
      }
    }

  BeefyConsensusState {
    latest_mmr_root: mmr_root,
    latest_height: block_number,
    beefy_activation_block,
    current_committee,
    next_committee,
  }
}

/// Verify signature `i` under the key of leaf `i` and sum the signers' seats; an empty signature marks a non-signer leaf.
pub fn check_auth_sigs_and_sum_seats(
  leaves: List<Leaf>,
  signatures: List<ByteArray>,
  msg_hash: ByteArray,
) -> Int {
  when signatures is {
    [] -> {
      expect [] = leaves
      0
    }
    [signature, ..rest_signatures] -> {
      expect [leaf, ..rest_leaves] = leaves
      expect builtin.length_of_bytearray(leaf) == 37

      let rest =
        check_auth_sigs_and_sum_seats(rest_leaves, rest_signatures, msg_hash)

      if signature == "" {
        rest
      } else {
        expect
          builtin.verify_ecdsa_secp256k1_signature(
            builtin.slice_bytearray(0, 33, leaf),
            msg_hash,
            signature,
          )

        rest + (
          builtin.slice_bytearray(33, 4, leaf)
            |> builtin.bytearray_to_integer(False, _)
        )
      }
    }
  }
}

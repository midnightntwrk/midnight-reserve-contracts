use aiken/builtin
use bridge/codec.{scale_encode_beefy_mmr_leaf, scale_encode_commitment}
use bridge/merkle.{verify_merkle_multi_proof_get_leaves}
use bridge/types.{
  BeefyConsensusProof, BeefyConsensusState, BeefyThreshold, Commitment, Leaf,
  Payload, RelayChainProof, SignedCommitment, Vote, next_committee_payload_id,
}
use utils.{must_find}

pub fn verify_consensus(
  trusted_state: BeefyConsensusState,
  proof: BeefyConsensusProof,
  threshold: BeefyThreshold,
  out_state: BeefyConsensusState,
) -> Bool {
  let state = verify_mmr_update_proof(trusted_state, proof.relay, threshold)

  state == out_state
}

pub fn verify_mmr_update_proof(
  trusted_state: BeefyConsensusState,
  relay_proof: RelayChainProof,
  threshold: BeefyThreshold,
) -> BeefyConsensusState {
  let BeefyConsensusState {
    latest_height: last_height,
    beefy_activation_block,
    current_authority_set,
    current_stake_total,
    next_authority_set,
    next_stake_total,
  } = trusted_state

  let RelayChainProof { signed_commitment, latest_mmr_leaf, proof } =
    relay_proof

  let SignedCommitment { commitment, votes } = signed_commitment

  let Commitment { block_number, validator_set_id, payloads } = commitment

  let BeefyThreshold { numerator, denominator } = threshold

  let threshold_fn =
    fn(threshold) { threshold * numerator + ( denominator - 1 ) / denominator }

  // Don't accept older signed commitments
  expect last_height < block_number

  let validating_root, validating_threshold <-
    fn(callback) {
      if validator_set_id == current_authority_set.id {
        callback(current_authority_set.root, threshold_fn(current_stake_total))
      } else {
        expect validator_set_id == next_authority_set.id
        callback(next_authority_set.root, threshold_fn(next_stake_total))
      }
    }

  let nc_payload =
    must_find(payloads, fn(x: Payload) { x.id == next_committee_payload_id })

  let leaves =
    verify_merkle_multi_proof_get_leaves(
      validating_root,
      proof |> builtin.un_list_data,
    )

  let signed_stake =
    check_auth_sigs_and_get_stake(
      leaves,
      votes,
      scale_encode_commitment(commitment)
        |> builtin.keccak_256,
    )

  expect signed_stake >= validating_threshold

  expect
    nc_payload.data == (
      scale_encode_beefy_mmr_leaf(latest_mmr_leaf) |> builtin.keccak_256
    )

  let
    current_authority_set,
    current_stake_total,
    next_authority_set,
    next_stake_total,
  <-
    fn(callback) {
      if latest_mmr_leaf.next_authority_set.id > trusted_state.next_authority_set.id {
        callback(
          next_authority_set,
          next_stake_total,
          latest_mmr_leaf.next_authority_set,
          latest_mmr_leaf.extra |> builtin.bytearray_to_integer(True, _),
        )
      } else {
        callback(
          current_authority_set,
          current_stake_total,
          next_authority_set,
          next_stake_total,
        )
      }
    }

  BeefyConsensusState {
    latest_height: block_number,
    beefy_activation_block,
    current_authority_set,
    current_stake_total,
    next_authority_set,
    next_stake_total,
  }
}

pub fn check_auth_sigs_and_get_stake(
  leaves: List<Leaf>,
  votes: List<Vote>,
  msg_hash: ByteArray,
) -> Int {
  when votes is {
    [] -> 0
    [v, ..vs] -> {
      let Vote { public_key, signature } = v

      let pkh = public_key |> builtin.keccak_256

      let rest_leaves, stake <- find_auth_in_leaves(leaves, pkh)

      expect
        builtin.verify_ecdsa_secp256k1_signature(
          public_key,
          msg_hash,
          signature,
        )

      check_auth_sigs_and_get_stake(rest_leaves, vs, msg_hash) + stake
    }
  }
}

/// Rather than doing a merge sort on chain.
/// The simpler option is to include all leaves necessary for the proof
/// And just ensure the authorized signatory leaf is included among the leaves
pub fn find_auth_in_leaves(leaves: List<Leaf>, pkh: ByteArray, callback) {
  expect [leaf, ..rest] = leaves

  let hash = builtin.slice_bytearray(0, 32, leaf)

  if pkh == hash {
    // Stake could never be a million bytes due to tx limits
    let stake =
      builtin.slice_bytearray(32, 1_000_000, leaf)
        |> builtin.bytearray_to_integer(True, _)

    callback(rest, stake)
  } else {
    find_auth_in_leaves(rest, pkh, callback)
  }
}

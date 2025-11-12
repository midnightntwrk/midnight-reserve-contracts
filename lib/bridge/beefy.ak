use aiken/builtin
use bridge/codec.{scale_encode_commitment}
use bridge/merkle.{verify_merkle_multi_proof_get_leaves, verify_mmr_leaf}
use bridge/types.{
  BeefyConsensusProof, BeefyConsensusState, BeefyThreshold, Commitment, Node,
  PartialConsensusProof, Payload, RelayChainProof, SignedCommitment, Vote,
  mmr_root_payload_id,
}
use cardano/assets.{PolicyId}
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

pub fn verify_consensus_no_merkle(
  trusted_state: BeefyConsensusState,
  relay_proof: PartialConsensusProof,
) {
  let latest_height = relay_proof.signed_commitment.commitment.block_number

  expect trusted_state.latest_height < latest_height

  // let sig_length =
  //   check_auth_sigs_and_get_len(
  //     leaves,
  //     relay_proof.signed_commitment.votes,
  //     scale_encode_commitment(relay_proof.signed_commitment.commitment)
  //       |> builtin.keccak_256,
  //   )
  //
  //
  // expect or {
  //     check_participation_threshold(
  //       sig_length,
  //       trusted_state.current_authority_set.len,
  //     ),
  //     check_participation_threshold(
  //       sig_length,
  //       trusted_state.next_authority_set.len,
  //     ),
  //   }
  let commitment = relay_proof.signed_commitment.commitment

  expect or {
      commitment.validator_set_id == trusted_state.current_authority_set.id,
      commitment.validator_set_id == trusted_state.next_authority_set.id,
    }

  True
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

  let RelayChainProof { signed_commitment, latest_mmr_leaf, mmr_proof, proof } =
    relay_proof

  let SignedCommitment { commitment, votes } = signed_commitment

  let Commitment { block_number, validator_set_id, payloads } = commitment

  // Don't accept older signed commitments
  expect last_height < block_number

  expect or {
      validator_set_id == current_authority_set.id,
      validator_set_id == next_authority_set.id,
    }

  let is_current_authorities = validator_set_id == current_authority_set.id

  let mmr_root =
    //Does the role of revert MmrRootHashMissing
    must_find(payloads, fn(x: Payload) { x.id == mmr_root_payload_id })

  let leaves =
    if is_current_authorities {
      verify_merkle_multi_proof_get_leaves(
        current_authority_set.root,
        proof |> builtin.un_list_data,
      )
    } else {
      verify_merkle_multi_proof_get_leaves(
        next_authority_set.root,
        proof |> builtin.un_list_data,
      )
    }

  let sig_length =
    check_auth_sigs_and_get_len(
      todo,
      relay_proof.signed_commitment.votes,
      scale_encode_commitment(relay_proof.signed_commitment.commitment)
        |> builtin.keccak_256,
    )

  expect or {
      check_participation_threshold(sig_length, current_authority_set.len),
      check_participation_threshold(sig_length, next_authority_set.len),
    }

  expect verify_mmr_leaf(beefy_activation_block, relay_proof, mmr_root.data)

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

pub fn check_participation_threshold(len: Int, total: Int) {
  len >= 2 * total / 3 + 1
}

pub fn check_auth_sigs_and_get_len(
  leaves: List<Node>,
  votes: List<Vote>,
  msg_hash: ByteArray,
) -> Int {
  when votes is {
    [] -> 0
    [v, ..vs] -> {
      let rest_leaves = find_auth_in_leaves(leaves, v, msg_hash)

      check_auth_sigs_and_get_len(rest_leaves, vs, msg_hash) + 1
    }
  }
}

/// Rather than doing a merge sort on chain.
/// The simpler option is to include all leaves necessary for the proof
/// And just ensure the authorized signatories are included among the leaves
pub fn find_auth_in_leaves(
  leaves: List<Node>,
  vote: Vote,
  msg_hash: ByteArray,
) -> List<Node> {
  expect [leaf, ..rest] = leaves

  let Node { k_index, hash } = leaf

  if k_index < vote.authority_index {
    find_auth_in_leaves(rest, vote, msg_hash)
  } else {
    let Vote { authority_index, public_key, signature, .. } = vote

    expect k_index == authority_index

    expect
      builtin.verify_ecdsa_secp256k1_signature(public_key, msg_hash, signature)

    let address = public_key

    expect hash == builtin.keccak_256(address)

    rest
  }
}

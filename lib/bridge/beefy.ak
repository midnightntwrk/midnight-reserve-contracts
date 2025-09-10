use aiken/builtin
use bridge/codec.{scale_encode_commitment}
use bridge/merkle.{verify_merkle_multi_proof, verify_mmr_leaf}
use bridge/types.{
  BeefyConsensusProof, BeefyConsensusState, Commitment, Node,
  PartialConsensusProof, Payload, RelayChainProof, Vote, mmr_root_payload_id,
}

pub fn verify_consensus(
  trusted_state: BeefyConsensusState,
  proof: BeefyConsensusProof,
) -> BeefyConsensusState {
  let state = verify_mmr_update_proof(trusted_state, proof.relay)

  state
}

pub fn verify_consensus_no_merkle(
  trusted_state: BeefyConsensusState,
  relay_proof: PartialConsensusProof,
) {
  let latest_height = relay_proof.signed_commitment.commitment.block_number

  expect trusted_state.latest_height < latest_height

  expect [leaves, ..] = relay_proof.proof |> builtin.un_list_data
  expect leaves: List<Node> = leaves

  let sig_length =
    check_auth_sigs_and_get_len(
      leaves,
      relay_proof.signed_commitment.votes,
      scale_encode_commitment(relay_proof.signed_commitment.commitment)
        |> builtin.keccak_256,
    )

  expect or {
      check_participation_threshold(
        sig_length,
        trusted_state.current_authority_set.len,
      ),
      check_participation_threshold(
        sig_length,
        trusted_state.next_authority_set.len,
      ),
    }

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
) -> BeefyConsensusState {
  let BeefyConsensusState {
    latest_height: last_height,
    beefy_activation_block,
    current_authority_set,
    next_authority_set,
  } = trusted_state

  let latest_height = relay_proof.signed_commitment.commitment.block_number

  expect last_height < latest_height

  expect [leaves, ..rest_proof] = relay_proof.proof |> builtin.un_list_data
  expect leaves: List<Node> = leaves

  let sig_length =
    check_auth_sigs_and_get_len(
      leaves,
      relay_proof.signed_commitment.votes,
      scale_encode_commitment(relay_proof.signed_commitment.commitment)
        |> builtin.keccak_256,
    )

  expect or {
      check_participation_threshold(sig_length, current_authority_set.len),
      check_participation_threshold(sig_length, next_authority_set.len),
    }

  let commitment = relay_proof.signed_commitment.commitment

  expect or {
      commitment.validator_set_id == current_authority_set.id,
      commitment.validator_set_id == next_authority_set.id,
    }

  let is_current_authorities =
    commitment.validator_set_id == current_authority_set.id

  let mmr_root =
    //Does the role of revert MmrRootHashMissing
    must_find(
      commitment.payloads,
      fn(x: Payload) { x.id == mmr_root_payload_id },
    )

  if is_current_authorities {
    expect
      verify_merkle_multi_proof(current_authority_set.root, leaves, rest_proof)
  } else {
    expect
      verify_merkle_multi_proof(next_authority_set.root, leaves, rest_proof)
  }

  expect verify_mmr_leaf(beefy_activation_block, relay_proof, mmr_root.data)

  let current_authority_set, next_authority_set <-
    fn(callback) {
      if relay_proof.latest_mmr_leaf.next_authority_set.id > trusted_state.next_authority_set.id {
        callback(
          next_authority_set,
          relay_proof.latest_mmr_leaf.next_authority_set,
        )
      } else {
        callback(current_authority_set, next_authority_set)
      }
    }

  BeefyConsensusState {
    latest_height,
    beefy_activation_block,
    current_authority_set,
    next_authority_set,
  }
}

pub fn check_participation_threshold(len: Int, total: Int) {
  len >= 2 * total / 3 + 1
}

pub fn must_find(list: List<a>, cond: fn(a) -> Bool) -> a {
  expect [x, ..xs] = list
  if cond(x) {
    x
  } else {
    must_find(xs, cond)
  }
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
    let Vote { authority_index, public_key, signature } = vote

    expect k_index == authority_index

    expect
      builtin.verify_ecdsa_secp256k1_signature(public_key, msg_hash, signature)

    let address = public_key

    expect hash == builtin.keccak_256(address)

    rest
  }
}

use aiken/builtin
use bridge/codec.{scale_encode_commitment}
use bridge/merkle.{verify_merkle_multi_proof_get_leaves, verify_mmr_leaf}
use bridge/types.{
  BeefyConsensusProof, BeefyConsensusState, BeefyThreshold, Commitment, Leaf,
  Payload, RelayChainProof, SignedCommitment, Vote, mmr_root_payload_id,
}
use utils.{must_find}

/// Entry point used by `committee_bridge_logic`.
/// Runs `verify_mmr_update_proof` against `trusted_state` and the redeemer
/// proof, then asserts the derived post-state equals the declared
/// `out_state` (read from the continuing output's datum). Returns `True`
/// on success; any check inside `verify_mmr_update_proof` that fails will
/// abort the script.
pub fn verify_consensus(
  trusted_state: BeefyConsensusState,
  proof: BeefyConsensusProof,
  threshold: BeefyThreshold,
  out_state: BeefyConsensusState,
) -> Bool {
  let state = verify_mmr_update_proof(trusted_state, proof.relay, threshold)

  state == out_state
}

/// Core BEEFY proof verifier. Derives the next `BeefyConsensusState` from
/// a `trusted_state` and a `RelayChainProof`, failing the script if any
/// check does not hold.
///
/// Steps, in order:
/// 1. The new commitment must strictly advance the checkpoint
///    (`block_number > trusted_state.latest_height`).
/// 2. Select the signing committee by matching
///    `commitment.validator_set_id` against either the current or the
///    next committee id; any other id aborts. Its `len` (total seat
///    count) is the threshold denominator.
/// 3. Locate the `"mh"` payload in the commitment (see
///    `mmr_root_payload_id`); its data is the signed MMR root.
/// 4. Verify the Merkle multi-proof against the signing committee's
///    `keyset_commitment` to extract the authority leaves that the votes
///    reference.
/// 5. Verify each vote's secp256k1 signature over
///    `keccak256(scale_encode_commitment(commitment))` and sum the
///    per-validator seat counts.
/// 6. Require the summed seats to meet the threshold. The threshold is
///    computed using the Substrate/BEEFY reference behaviour: the
///    `(denominator - 1)` bias in the inline `threshold_fn` implements
///    integer ceiling.
/// 7. Prove `latest_mmr_leaf` against the signed MMR root via
///    `verify_mmr_leaf`.
/// 8. If the incoming leaf advances the next-committee id, rotate: the
///    old next committee becomes current, and the leaf's
///    `next_authority_set` becomes the new next committee.
///
/// Returns the rotated-or-unrotated `BeefyConsensusState` with
/// `latest_mmr_root` set to the signed root and `latest_height` set to
/// `block_number`.
pub fn verify_mmr_update_proof(
  trusted_state: BeefyConsensusState,
  relay_proof: RelayChainProof,
  threshold: BeefyThreshold,
) -> BeefyConsensusState {
  let BeefyConsensusState {
    latest_height: last_height,
    beefy_activation_block,
    current_committee,
    next_committee,
    ..
  } = trusted_state

  let RelayChainProof { signed_commitment, latest_mmr_leaf, mmr_proof, proof } =
    relay_proof

  let SignedCommitment { commitment, votes } = signed_commitment

  let Commitment { block_number, validator_set_id, payloads } = commitment

  let BeefyThreshold { numerator, denominator } = threshold

  let threshold_fn =
    fn(threshold) { ( threshold * numerator + denominator - 1 ) / denominator }

  // Don't accept older signed commitments
  expect last_height < block_number

  let validating_root, validating_threshold <-
    fn(callback) {
      if validator_set_id == current_committee.id {
        callback(
          current_committee.keyset_commitment,
          threshold_fn(current_committee.len),
        )
      } else {
        expect validator_set_id == next_committee.id
        callback(
          next_committee.keyset_commitment,
          threshold_fn(next_committee.len),
        )
      }
    }

  let mmr_root =
    must_find(payloads, fn(x: Payload) { x.id == mmr_root_payload_id })

  let leaves =
    verify_merkle_multi_proof_get_leaves(
      validating_root,
      proof |> builtin.un_list_data,
    )

  let signed_seats =
    check_auth_sigs_and_sum_seats(
      leaves,
      votes,
      scale_encode_commitment(commitment)
        |> builtin.keccak_256,
    )

  expect signed_seats >= validating_threshold

  expect verify_mmr_leaf(latest_mmr_leaf, mmr_proof, mmr_root.data)

  let current_committee, next_committee <-
    fn(callback) {
      if latest_mmr_leaf.next_authority_set.id > next_committee.id {
        callback(next_committee, latest_mmr_leaf.next_authority_set)
      } else {
        callback(current_committee, next_committee)
      }
    }

  BeefyConsensusState {
    latest_mmr_root: mmr_root.data,
    latest_height: block_number,
    beefy_activation_block,
    current_committee,
    next_committee,
  }
}

/// Walks the vote list in order, and for each vote:
///   - looks up the matching authority leaf via `find_auth_in_leaves`,
///     which returns the leaf's seat count and the remaining unused
///     leaves;
///   - verifies the ECDSA/secp256k1 signature against `msg_hash`;
///   - adds the leaf's seat count to the running total.
///
/// Relies on leaves and votes being supplied in the same order (the
/// authority-leaf lookup never rewinds). `find_auth_in_leaves` aborts if a
/// voter's key is not present in the remaining leaves, so every vote must
/// be accounted for; there is no silent skip.
pub fn check_auth_sigs_and_sum_seats(
  leaves: List<Leaf>,
  votes: List<Vote>,
  msg_hash: ByteArray,
) -> Int {
  when votes is {
    [] -> 0
    [v, ..vs] -> {
      let Vote { public_key, signature } = v

      let rest_leaves, seats <- find_auth_in_leaves(leaves, public_key)

      expect
        builtin.verify_ecdsa_secp256k1_signature(
          public_key,
          msg_hash,
          signature,
        )

      check_auth_sigs_and_sum_seats(rest_leaves, vs, msg_hash) + seats
    }
  }
}

/// Rather than doing a merge sort on chain.
/// The simpler option is to include all leaves necessary for the proof
/// And just ensure the authorized signatory leaf is included among the leaves
pub fn find_auth_in_leaves(leaves: List<Leaf>, public_key: ByteArray, callback) {
  expect [leaf, ..rest] = leaves

  let key = builtin.slice_bytearray(0, 33, leaf)

  if public_key == key {
    // Little-endian u64 seat count directly after the 33-byte key
    let seats =
      builtin.slice_bytearray(33, 8, leaf)
        |> builtin.bytearray_to_integer(False, _)

    callback(rest, seats)
  } else {
    find_auth_in_leaves(rest, public_key, callback)
  }
}

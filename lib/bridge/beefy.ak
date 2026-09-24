//// Light-client update: MIP rules 1–10 (spec §5) and the next state. Rule 0
//// (the continuing output) lives in `validators/committee_bridge.ak`, the
//// pool rules in `bridge/pool.ak`; rule 4 (key order) is not enforced, the
//// multiproof root already binds the leaves.

use aiken/builtin
use bridge/codec.{scale_encode_beefy_mmr_leaf, scale_encode_commitment}
use bridge/merkle.{verify_mmr_leaf, verify_multiproof}
use bridge/types.{BeefyConsensusState, BeefyThreshold, BridgeUpdate, Leaf}

/// Seats a quorum needs: `seat_count − ⌊(seat_count − 1)(d − n) / d⌋`.
pub fn required(seat_count: Int, numerator: Int, denominator: Int) -> Int {
  seat_count - ( seat_count - 1 ) * ( denominator - numerator ) / denominator
}

/// Apply MIP rules 1–10 to `update`; any failed rule aborts. Continues with the next state and the multiproof leaf count.
pub fn verify_update(
  state: BeefyConsensusState,
  update: BridgeUpdate,
  threshold: BeefyThreshold,
  continue: fn(BeefyConsensusState, Int) -> r,
) -> r {
  let BeefyConsensusState {
    latest_height,
    beefy_activation_block,
    current_committee,
    next_committee,
    ..
  } = state

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

  expect block_number > latest_height

  let signing =
    if validator_set_id == current_committee.validator_set_id {
      current_committee
    } else {
      expect validator_set_id == next_committee.validator_set_id
      next_committee
    }

  let leaves = verify_multiproof(signing.keyset_commitment, multiproof)

  let msg_hash =
    scale_encode_commitment(mmr_root, block_number, validator_set_id)
      |> builtin.keccak_256

  let seats, leaf_count <- sum_signed_seats(leaves, signatures, msg_hash)

  expect seats >= required(signing.seat_count, numerator, denominator)

  expect leaf.parent_number == block_number - 1

  expect
    verify_mmr_leaf(
      mmr_root,
      scale_encode_beefy_mmr_leaf(leaf) |> builtin.keccak_256,
      block_number - 1,
      block_number,
      mmr_proof,
    )

  let next_id = next_committee.validator_set_id
  let leaf_next_id = leaf.next_authority_set.validator_set_id

  expect leaf_next_id == next_id || leaf_next_id == next_id + 1
  expect validator_set_id != next_id || leaf_next_id == next_id + 1

  let next_state =
    if leaf_next_id == next_id + 1 {
      BeefyConsensusState {
        latest_mmr_root: mmr_root,
        latest_height: block_number,
        beefy_activation_block,
        current_committee: next_committee,
        next_committee: leaf.next_authority_set,
      }
    } else {
      BeefyConsensusState {
        ..state,
        latest_mmr_root: mmr_root,
        latest_height: block_number,
      }
    }

  continue(next_state, leaf_count)
}

/// Rule 5: one signature per multiproof leaf (`""` for a non-signer). Continues with the signed seats and the leaf count.
pub fn sum_signed_seats(
  leaves: List<Leaf>,
  signatures: List<ByteArray>,
  msg_hash: ByteArray,
  continue: fn(Int, Int) -> r,
) -> r {
  when signatures is {
    [] -> {
      expect [] = leaves
      continue(0, 0)
    }
    [signature, ..rest_signatures] -> {
      expect [leaf, ..rest_leaves] = leaves
      expect builtin.length_of_bytearray(leaf) == 37

      let
        seats,
        count,
      <- sum_signed_seats(rest_leaves, rest_signatures, msg_hash)

      if signature == "" {
        continue(seats, count + 1)
      } else {
        expect
          builtin.verify_ecdsa_secp256k1_signature(
            builtin.slice_bytearray(0, 33, leaf),
            msg_hash,
            signature,
          )

        continue(
          seats + (
            builtin.slice_bytearray(33, 4, leaf)
              |> builtin.bytearray_to_integer(False, _)
          ),
          count + 1,
        )
      }
    }
  }
}

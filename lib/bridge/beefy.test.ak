use aiken/collection/list
use aiken/primitive/bytearray
use bridge/beefy.{required, verify_update}
use bridge/test_fixtures as fx
use bridge/types.{AuthoritySetCommitment, BeefyConsensusState, BridgeUpdate}

// MIP quorum table at (2, 3).
test required_table() {
  and {
    required(10, 2, 3) == 7,
    required(6, 2, 3) == 5,
    required(3, 2, 3) == 3,
    required(1, 2, 3) == 1,
    required(4, 2, 3) == 3,
  }
}

fn advanced(st: BeefyConsensusState, s: fx.Scenario) -> BeefyConsensusState {
  BeefyConsensusState {
    ..st,
    latest_mmr_root: s.mmr_root,
    latest_height: s.block_number,
  }
}

// Boundary accept: block_number = latest_height + 1, seats = required, leaf names next.
test accept_no_handover() {
  let st = fx.state(4, 5, 6)
  verify_update(st, fx.update(fx.a_no_handover), fx.threshold) == advanced(
    st,
    fx.a_no_handover,
  )
}

test accept_handover() {
  let st = fx.state(4, 5, 7)
  verify_update(st, fx.update(fx.b_handover), fx.threshold) == BeefyConsensusState {
    latest_mmr_root: fx.b_handover.mmr_root,
    latest_height: 8,
    beefy_activation_block: 1,
    current_committee: fx.committee(5),
    next_committee: fx.committee(6),
  }
}

test accept_block_one() {
  let st = fx.state(4, 5, 0)
  verify_update(st, fx.update(fx.e_block_one), fx.threshold) == advanced(
    st,
    fx.e_block_one,
  )
}

test accept_signers_only_multiproof() {
  let st = fx.state(4, 5, 6)
  and {
    verify_update(
      st,
      fx.update_with(fx.a_no_handover, [0, 1], [0, 1]),
      fx.threshold,
    ) == advanced(st, fx.a_no_handover),
    verify_update(
      st,
      fx.update_with(fx.a_no_handover, [1, 2], [1, 2]),
      fx.threshold,
    ) == advanced(st, fx.a_no_handover),
    verify_update(
      st,
      fx.update_with(fx.a_no_handover, [0, 1, 2], [0, 1, 2]),
      fx.threshold,
    ) == advanced(st, fx.a_no_handover),
  }
}

// Rule 1.
test reject_stale_height() fail {
  let st = fx.state(4, 5, 7)
  verify_update(st, fx.update(fx.a_no_handover), fx.threshold) != st
}

// Rule 2.
test reject_unknown_set() fail {
  let st = fx.state(6, 7, 6)
  verify_update(st, fx.update(fx.a_no_handover), fx.threshold) != st
}

// Rule 3.
test reject_wrong_keyset() fail {
  let st = fx.state(4, 5, 6)
  let st =
    BeefyConsensusState {
      ..st,
      current_committee: AuthoritySetCommitment {
        ..st.current_committee,
        keyset_commitment: fx.keccak(fx.keyset_root),
      },
    }
  verify_update(st, fx.update(fx.a_no_handover), fx.threshold) != st
}

// Rule 5.
test reject_bad_signature() fail {
  let s = fx.a_no_handover
  let update = fx.update(s)
  expect [sig0, ..rest] = update.signatures
  let flipped = bytearray.concat(#"00", bytearray.drop(sig0, 1))
  let update = BridgeUpdate { ..update, signatures: [flipped, ..rest] }
  verify_update(fx.state(4, 5, 6), update, fx.threshold) != fx.state(4, 5, 6)
}

// Same r, s' = n - s: valid under a malleable verifier, rejected by the builtin.
test reject_high_s_signature() fail {
  let update = fx.update(fx.a_no_handover)
  expect [_, ..rest] = update.signatures
  let high_s =
    #"b6cda229807a87bb7c59c97b06cdb7e166599f551102bcb3f2a22def7b7714c9bf5c2ac2f16187c52456adc89e0c73508958ce7a9de5318e5483cd29f03c9be8"
  let update = BridgeUpdate { ..update, signatures: [high_s, ..rest] }
  verify_update(fx.state(4, 5, 6), update, fx.threshold) != fx.state(4, 5, 6)
}

test reject_swapped_signatures() fail {
  let s = fx.a_no_handover
  let update = fx.update(s)
  expect [sig0, sig1, sig2] = update.signatures
  let update = BridgeUpdate { ..update, signatures: [sig1, sig0, sig2] }
  verify_update(fx.state(4, 5, 6), update, fx.threshold) != fx.state(4, 5, 6)
}

test reject_fewer_signatures() fail {
  let update = fx.update(fx.a_no_handover)
  let update =
    BridgeUpdate { ..update, signatures: list.take(update.signatures, 2) }
  verify_update(fx.state(4, 5, 6), update, fx.threshold) != fx.state(4, 5, 6)
}

test reject_more_signatures() fail {
  let update = fx.update(fx.a_no_handover)
  let update =
    BridgeUpdate { ..update, signatures: list.concat(update.signatures, [""]) }
  verify_update(fx.state(4, 5, 6), update, fx.threshold) != fx.state(4, 5, 6)
}

test reject_other_commitment_signature() fail {
  let update = fx.update(fx.a_no_handover)
  let update = BridgeUpdate { ..update, signatures: fx.d_skip_two.sigs }
  verify_update(fx.state(4, 5, 6), update, fx.threshold) != fx.state(4, 5, 6)
}

// Rule 6: seats (1, 2, 1), required 3.
test reject_quorum_short() fail {
  verify_update(
    fx.state(4, 5, 6),
    fx.update_with(fx.a_no_handover, [0, 1, 2], [0, 2]),
    fx.threshold,
  ) != fx.state(4, 5, 6)
}

test reject_single_signer() fail {
  verify_update(
    fx.state(4, 5, 6),
    fx.update_with(fx.a_no_handover, [1], [1]),
    fx.threshold,
  ) != fx.state(4, 5, 6)
}

test reject_no_signers() fail {
  verify_update(
    fx.state(4, 5, 6),
    fx.update_with(fx.a_no_handover, [0, 1, 2], []),
    fx.threshold,
  ) != fx.state(4, 5, 6)
}

// Rule 7.
test reject_parent_number() fail {
  let update = fx.update(fx.a_no_handover)
  let leaf = update.leaf
  let update =
    BridgeUpdate {
      ..update,
      leaf: fx.leaf_with_parent(leaf, leaf.parent_number - 1),
    }
  verify_update(fx.state(4, 5, 6), update, fx.threshold) != fx.state(4, 5, 6)
}

// Rule 8.
test reject_mmr_proof() fail {
  let update = fx.update(fx.a_no_handover)
  expect [first, ..rest] = update.mmr_proof
  let update = BridgeUpdate { ..update, mmr_proof: [fx.keccak(first), ..rest] }
  verify_update(fx.state(4, 5, 6), update, fx.threshold) != fx.state(4, 5, 6)
}

// Rule 9: leaf names next + 2.
test reject_skip_two() fail {
  verify_update(fx.state(4, 5, 6), fx.update(fx.d_skip_two), fx.threshold) != fx.state(
    4,
    5,
    6,
  )
}

// Rule 10: next committee signs a leaf that does not advance.
test reject_next_signs_without_handover() fail {
  verify_update(
    fx.state(4, 5, 7),
    fx.update(fx.c_next_signs_same),
    fx.threshold,
  ) != fx.state(4, 5, 7)
}

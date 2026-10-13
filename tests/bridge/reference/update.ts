/** `BridgeUpdate` and `BeefyConsensusState` as the blueprint types, from a scenario. */
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  AuthoritySetCommitment,
  BeefyConsensusState,
  BridgeUpdate,
} from "../../../contract_blueprint";
import { committee, type Scenario } from "./fixtures";
import { buildMultiproof, toPlutusData } from "./multiproof";
import type { Commitment } from "./scale";

export const hex = bytesToHex;

export function toCommitment(c: Commitment): AuthoritySetCommitment {
  return {
    validator_set_id: c.validatorSetId,
    seat_count: BigInt(c.seatCount),
    keyset_commitment: hex(c.keysetCommitment),
  };
}

/** The update for `s`: multiproof over `proofLeaves` (tree order), signatures from `signers`, `""` for the rest. */
export function bridgeUpdate(
  s: Scenario,
  proofLeaves: readonly number[],
  signers: readonly number[],
): BridgeUpdate {
  const signerSet = new Set(signers);
  return {
    mmr_root: hex(s.mmrRoot),
    block_number: BigInt(s.blockNumber),
    validator_set_id: s.setId,
    signatures: proofLeaves.map((i) =>
      signerSet.has(i) ? hex(s.sigs[i]) : "",
    ),
    leaf: {
      version: 0n,
      parent_number: BigInt(s.leaf.parentNumber),
      parent_hash: hex(s.leaf.parentHash),
      next_authority_set: toCommitment(s.leaf.nextAuthoritySet),
      extra: "",
    },
    mmr_proof: s.mmr.proof(s.blockNumber - 1).map(hex),
    multiproof: toPlutusData(
      buildMultiproof(committee.leaves, new Set(proofLeaves)),
    ),
  };
}

/** Rules 9 and 10 applied: the state after `s`, or `null` when the leaf's successor is out of range. */
export function nextState(
  state: BeefyConsensusState,
  s: Scenario,
): BeefyConsensusState | null {
  const nextId = state.next_committee.validator_set_id;
  const leafNextId = s.leaf.nextAuthoritySet.validatorSetId;
  if (leafNextId !== nextId && leafNextId !== nextId + 1n) return null;
  if (s.setId === nextId && leafNextId !== nextId + 1n) return null;
  const handover = leafNextId === nextId + 1n;
  return {
    ...state,
    latest_mmr_root: hex(s.mmrRoot),
    latest_height: BigInt(s.blockNumber),
    current_committee: handover
      ? state.next_committee
      : state.current_committee,
    next_committee: handover
      ? toCommitment(s.leaf.nextAuthoritySet)
      : state.next_committee,
  };
}

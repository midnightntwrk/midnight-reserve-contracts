/**
 * Committees of fixed keypairs and the updates they sign, for chaining
 * sessions: a committee (keys with seats under a validator set id) signs a
 * block's MMR root, and its leaf names the committee after it. Filler leaves
 * and parent hashes are the `fixtures.ts` ones.
 */
import type {
  BridgeUpdate,
  BeefyConsensusState,
} from "../../../contract_blueprint";
import {
  buildMultiproof,
  required,
  toPlutusData,
} from "../../../cli/bridge/authority-set";
import { keccak } from "../../../cli/bridge/keccak";
import { committeeCommitment } from "./commitment";
import { dummyLeafHash, parentHash } from "./fixtures";
import { Mmr } from "./mmr";
import {
  type Commitment,
  encodeCommitment,
  encodeLeaf,
  type MmrLeaf,
} from "./scale";
import { byKey, keypair, sign, type Keypair } from "./sign";
import { hex, toCommitment } from "./update";

export interface Committee {
  /** Key order: the multiproof's leaf order. */
  readonly members: readonly { readonly kp: Keypair; readonly seats: number }[];
  readonly commitment: Commitment;
  readonly leaves: readonly Uint8Array[];
}

/** The committee of the keys of `scalars` holding `seats`, as set `id`. */
export function committeeOf(
  id: bigint,
  scalars: readonly bigint[],
  seats: readonly number[],
): Committee {
  const members = scalars
    .map((scalar, i) => ({ kp: keypair(scalar), seats: seats[i] }))
    .sort((a, b) => byKey(a.kp, b.kp));
  const { commitment, leaves } = committeeCommitment(
    id,
    members.map((m) => ({ key: m.kp.public, seats: m.seats })),
  );
  return { members, commitment, leaves };
}

/** The same keys as the next set. */
export const renumbered = (c: Committee, id: bigint): Committee => ({
  ...c,
  commitment: { ...c.commitment, validatorSetId: id },
});

/** A minimal 2/3 cover of the committee: the most seats first, until the quorum. */
export function quorum(c: Committee): number[] {
  const need = required(c.commitment.seatCount, 2, 3);
  const bySeats = c.members
    .map((m, i) => ({ i, seats: m.seats }))
    .sort((a, b) => b.seats - a.seats);
  const picked: number[] = [];
  let seats = 0;
  for (const m of bySeats) {
    if (seats >= need) break;
    picked.push(m.i);
    seats += m.seats;
  }
  return picked.sort((a, b) => a - b);
}

/** The state a bootstrap mints: `current` then `next`, height the block before activation. */
export const bootstrapOf = (
  current: Committee,
  next: Committee,
  activation: number,
): BeefyConsensusState => ({
  latest_mmr_root: hex(keccak(new TextEncoder().encode("bootstrap root"))),
  latest_height: BigInt(activation - 1),
  beefy_activation_block: BigInt(activation),
  current_committee: toCommitment(current.commitment),
  next_committee: toCommitment(next.commitment),
});

/** The update of `block` by `by`, whose leaf names `names`: `signers` sign, the multiproof reveals `revealed` (the signers by default); `parentNumber` other than the block before commits a leaf that breaks rule 7 only. */
export function signedUpdate(
  by: Committee,
  block: number,
  names: Commitment,
  signers: readonly number[],
  revealed: readonly number[] = signers,
  parentNumber = block - 1,
): BridgeUpdate {
  const leaf: MmrLeaf = {
    parentNumber,
    parentHash: parentHash(block),
    nextAuthoritySet: names,
  };
  const hashes = Array.from({ length: block - 1 }, (_, i) => dummyLeafHash(i));
  hashes.push(keccak(encodeLeaf(leaf)));
  const mmr = new Mmr(hashes);
  const root = mmr.root();
  const message = keccak(
    encodeCommitment(root, block, by.commitment.validatorSetId),
  );
  const signing = new Set(signers);
  const proofLeaves = [...new Set(revealed)].sort((a, b) => a - b);
  return {
    mmr_root: hex(root),
    block_number: BigInt(block),
    validator_set_id: by.commitment.validatorSetId,
    signatures: proofLeaves.map((i) =>
      signing.has(i) ? hex(sign(by.members[i].kp, message)) : "",
    ),
    leaf: {
      version: 0n,
      parent_number: BigInt(leaf.parentNumber),
      parent_hash: hex(leaf.parentHash),
      next_authority_set: toCommitment(names),
      extra: "",
    },
    mmr_proof: mmr.proof(block - 1).map(hex),
    multiproof: toPlutusData(buildMultiproof(by.leaves, new Set(proofLeaves))),
  };
}

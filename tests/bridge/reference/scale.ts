/**
 * SCALE encodings the bridge verifies: the 48-byte signed commitment, the
 * 82-byte MMR leaf. Fixed-width fields
 * concatenated without delimiters; the 32/33-byte checks make them injective.
 */
import { concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { u32le } from "../../../cli/bridge/scale";

export type Commitment = {
  validatorSetId: bigint;
  seatCount: number;
  keysetCommitment: Uint8Array;
};

/** `pallet-beefy-mmr` leaf, version 0 with empty `extra`. */
export type MmrLeaf = {
  parentNumber: number;
  parentHash: Uint8Array;
  nextAuthoritySet: Commitment;
};

/** SCALE payload list prefix: one payload, id `"mh"`, compact length 32. */
const COMMITMENT_PREFIX = hexToBytes("046d6880");

export function hash32(b: Uint8Array): Uint8Array {
  if (b.length !== 32) throw new Error(`expected 32 bytes, got ${b.length}`);
  return b;
}

function u64le(n: bigint): Uint8Array {
  if (n < 0n || n > 0xffff_ffff_ffff_ffffn) throw new Error(`not a u64: ${n}`);
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

/** `04 6d68 80 ‖ mmr_root ‖ block_number (u32 LE) ‖ validator_set_id (u64 LE)`. */
export function encodeCommitment(
  mmrRoot: Uint8Array,
  blockNumber: number,
  validatorSetId: bigint,
): Uint8Array {
  return concatBytes(
    COMMITMENT_PREFIX,
    hash32(mmrRoot),
    u32le(blockNumber),
    u64le(validatorSetId),
  );
}

/** `00 ‖ parent_number ‖ parent_hash ‖ set_id ‖ seat_count ‖ keyset_commitment ‖ 00`. */
export function encodeLeaf(leaf: MmrLeaf): Uint8Array {
  const { validatorSetId, seatCount, keysetCommitment } = leaf.nextAuthoritySet;
  return concatBytes(
    new Uint8Array([0]),
    u32le(leaf.parentNumber),
    hash32(leaf.parentHash),
    u64le(validatorSetId),
    u32le(seatCount),
    hash32(keysetCommitment),
    new Uint8Array([0]),
  );
}

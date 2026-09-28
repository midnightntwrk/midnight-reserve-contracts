/**
 * The DigestProof of a rewards digest (docs/rewards/spec.md §7): the SCALE
 * header of the block that holds the submit_rewards_digest extrinsic, the
 * extrinsics-trie proof of that extrinsic, and the MMR proof of the leaf the
 * next block adds under the bridge's root of `latest_height` leaves. Each
 * piece is checked here against what the chain commits to (the header
 * against the block hash, the trie against extrinsics_root, the leaf
 * against the block), so a proof that leaves this module is the one
 * lib/rewards/digest.ak verifies.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, concatBytes } from "@noble/hashes/utils.js";
import { Effect } from "effect";
import type { DigestProof } from "../../contract_blueprint";
import { blockAt, blockHash, leafProofIn } from "../bridge/midnight";
import { PreconditionFailed } from "../errors";
import { compactEncode, extrinsicsTrie, trieProof, trieRoot } from "./trie";

/** The extrinsic of the MIP digest form: Compact(123) plus 123 bytes. */
const DIGEST_EXTRINSIC_LENGTH = 125;

/** A block header's fields, as the node reports them. */
export interface HeaderFields {
  readonly parentHash: Uint8Array;
  readonly number: number;
  readonly stateRoot: Uint8Array;
  readonly extrinsicsRoot: Uint8Array;
  readonly digest: { readonly logs: readonly Uint8Array[] };
}

/** The SCALE header (`generic::Header<u32, BlakeTwo256>`), whose blake2b-256 is the block hash. */
export const encodeHeader = (h: HeaderFields): Uint8Array =>
  concatBytes(
    h.parentHash,
    compactEncode(h.number),
    h.stateRoot,
    h.extrinsicsRoot,
    compactEncode(h.digest.logs.length),
    ...h.digest.logs,
  );

/** The index of the bare submit_rewards_digest extrinsic: 125 bytes, preamble 0x05, then the pallet and call indices. */
export const rewardsExtrinsicIndex = (
  extrinsics: readonly Uint8Array[],
  pallet: number,
  call: number,
): number =>
  extrinsics.findIndex(
    (xt) =>
      xt.length === DIGEST_EXTRINSIC_LENGTH &&
      xt[2] === 0x05 &&
      xt[3] === pallet &&
      xt[4] === call,
  );

const mismatch = (detail: string) =>
  new PreconditionFailed({
    command: "Midnight node",
    refusal: { _tag: "MidnightNotMip", detail },
  });

/** The DigestProof of the digest in block `block`, under the MMR of `latestHeight` leaves. */
export const digestProofAt = (
  rpc: string,
  block: number,
  latestHeight: number,
  pallet: number,
  call: number,
) =>
  Effect.gen(function* () {
    const hash = yield* blockHash(rpc, block);
    const { header, extrinsics } = yield* blockAt(rpc, hash);
    const encoded = encodeHeader(header);
    if (`0x${bytesToHex(blake2b(encoded, { dkLen: 32 }))}` !== hash) {
      return yield* mismatch(
        `the header of block ${block} does not hash to ${hash}`,
      );
    }
    const index = rewardsExtrinsicIndex(extrinsics, pallet, call);
    if (index < 0) {
      return yield* mismatch(
        `block ${block} holds no submit_rewards_digest (pallet ${pallet}, call ${call})`,
      );
    }
    const trie = extrinsicsTrie(extrinsics);
    if (bytesToHex(trieRoot(trie)) !== bytesToHex(header.extrinsicsRoot)) {
      return yield* mismatch(
        `the extrinsics of block ${block} do not match its extrinsics_root`,
      );
    }
    const { leaf, proof } = yield* leafProofIn(
      rpc,
      block + 1,
      latestHeight,
      yield* blockHash(rpc, latestHeight),
    );
    if (leaf.parentNumber !== block) {
      return yield* mismatch(
        `the leaf of block ${block + 1} names parent ${leaf.parentNumber}`,
      );
    }
    const digestProof: DigestProof = {
      leaf: {
        version: BigInt(leaf.version),
        parent_number: BigInt(leaf.parentNumber),
        parent_hash: bytesToHex(leaf.parentHash),
        next_authority_set: leaf.nextAuthoritySet,
        extra: "",
      },
      items: proof.items.map(bytesToHex),
      header: bytesToHex(encoded),
      extrinsic_index: BigInt(index),
      trie_nodes: trieProof(trie, index).map(bytesToHex),
      extrinsic: bytesToHex(extrinsics[index]),
    };
    return digestProof;
  });

/** The digest fields of a submit_rewards_digest extrinsic (spec §7.1): epoch, leaf count, root, key range and Treasury share. */
export const decodeDigest = (extrinsic: Uint8Array) => {
  const view = new DataView(extrinsic.buffer, extrinsic.byteOffset);
  return {
    epoch: view.getBigUint64(5, true),
    leafCount: view.getBigUint64(13, true),
    root: bytesToHex(extrinsic.slice(21, 53)),
    minKey: bytesToHex(extrinsic.slice(53, 81)),
    maxKey: bytesToHex(extrinsic.slice(81, 109)),
    treasuryTotal:
      view.getBigUint64(109, true) + (view.getBigUint64(117, true) << 64n),
  };
};

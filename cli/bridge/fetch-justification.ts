/**
 * bridge-fetch-justification: the BridgeUpdate of a Midnight block's BEEFY
 * justification, the light-client module of the MIP data pump in
 * TypeScript. The justification (engine `BEEF`) gives the signed root and
 * one signature slot per seat; the validator set at the block maps slots to
 * keys. Seats are summed per key, the 65-byte signatures lose their
 * recovery byte, and the signers are trimmed to a minimal cover of the
 * threshold the BEEFY threshold UTxO holds (most seats first), since rule
 * 6 rejects a surplus signer. `mmr_generateProof` gives the leaf the block
 * adds and its proof items, already in the order rule 8 walks.
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect, Either, Schema } from "effect";
import { environmentOf } from "../config/network-mapping";
import { BridgeUpdateJson } from "../datum/bridge";
import { PreconditionFailed, type Refusal } from "../errors";
import { type TxFileInput, txFilePath } from "../input";
import { Output } from "../output";
import {
  authorityLeaf,
  buildMultiproof,
  required,
  toPlutusData,
} from "./authority-set";
import { beefyThresholdAt, bridgeScripts, bridgeUtxos } from "./bridge-chain";
import {
  blockHash,
  justificationAt,
  leafProofAt,
  validatorSetAt,
} from "./midnight";
import type { FinalityProof, LeafProof, MmrLeaf, ValidatorSet } from "./scale";

/** A BEEFY threshold fraction. */
export interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** The update and the quorum it carries. */
export interface JustifiedUpdate {
  readonly update: typeof BridgeUpdateJson.Type;
  readonly keys: number;
  readonly signers: number;
  readonly seats: number;
  readonly seatCount: number;
  readonly required: number;
}

const notMip = (detail: string): Refusal => ({
  _tag: "MidnightNotMip",
  detail,
});

/** The BridgeUpdate of block `block` from its justification, the validator set at it, and its leaf and leaf proof. */
export const updateFromJustification = (
  block: number,
  proof: FinalityProof,
  set: ValidatorSet,
  leaf: MmrLeaf,
  leafProof: LeafProof,
  threshold: Fraction,
): Either.Either<JustifiedUpdate, Refusal> => {
  const [mh, ...rest] = proof.payload;
  if (mh?.id !== "mh" || mh.data.length !== 32 || rest.length > 0)
    return Either.left(
      notMip(
        `the payload of block ${block} holds [${proof.payload.map((p) => p.id).join(", ")}], not the MMR root alone`,
      ),
    );
  if (set.id !== proof.validatorSetId)
    return Either.left(
      notMip(
        `set ${proof.validatorSetId} signed block ${block}, whose validator set is ${set.id}`,
      ),
    );
  const [index, ...others] = leafProof.leafIndices;
  if (
    index !== BigInt(block - 1) ||
    others.length > 0 ||
    leafProof.leafCount !== BigInt(block)
  )
    return Either.left(
      notMip(
        `the leaf of block ${block} is at index ${leafProof.leafIndices.join(",")} of ${leafProof.leafCount}, not ${block - 1} of ${block}`,
      ),
    );
  if (leaf.extra.length > 0)
    return Either.left(notMip(`the leaf of block ${block} has extra data`));

  const byKey = new Map<
    string,
    { key: Uint8Array; seats: number; signature?: Uint8Array }
  >();
  set.keys.forEach((key, i) => {
    const k = bytesToHex(key);
    const member = byKey.get(k) ?? { key, seats: 0 };
    byKey.set(k, {
      ...member,
      seats: member.seats + 1,
      signature: member.signature ?? proof.signatures[i],
    });
  });
  const members = [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, m]) => m);
  const seatCount = set.keys.length;
  const need = required(
    seatCount,
    Number(threshold.numerator),
    Number(threshold.denominator),
  );
  const signing = members
    .map((m, i) => ({ i, seats: m.seats, signed: m.signature !== undefined }))
    .filter((m) => m.signed)
    .sort((a, b) => b.seats - a.seats);
  const cover: number[] = [];
  let seats = 0;
  for (const m of signing) {
    if (seats >= need) break;
    cover.push(m.i);
    seats += m.seats;
  }
  if (seats < need)
    return Either.left({
      _tag: "BelowThreshold",
      signedSeats: seats,
      seatCount,
      required: need,
      numerator: threshold.numerator,
      denominator: threshold.denominator,
    });
  cover.sort((a, b) => a - b);

  return Either.right({
    update: {
      mmr_root: bytesToHex(mh.data),
      block_number: BigInt(block),
      validator_set_id: proof.validatorSetId,
      signatures: cover.map((i) =>
        bytesToHex(members[i].signature!.slice(0, 64)),
      ),
      leaf: {
        version: BigInt(leaf.version),
        parent_number: BigInt(leaf.parentNumber),
        parent_hash: bytesToHex(leaf.parentHash),
        next_authority_set: leaf.nextAuthoritySet,
        extra: "" as const,
      },
      mmr_proof: leafProof.items.map(bytesToHex),
      multiproof: toPlutusData(
        buildMultiproof(
          members.map((m) => authorityLeaf(m.key, m.seats)),
          new Set(cover),
        ),
      ),
    },
    keys: members.length,
    signers: cover.length,
    seats,
    seatCount,
    required: need,
  });
};

/** The node, the block, and where the BridgeUpdate file goes. */
export interface BridgeFetchJustificationInput extends TxFileInput {
  readonly rpc: string;
  readonly block: bigint;
}

/** Read the threshold from Cardano and the justification from Midnight, and write the BridgeUpdate file. */
export const bridgeFetchJustificationProgram = (
  input: BridgeFetchJustificationInput,
) =>
  Effect.gen(function* () {
    const { network, rpc } = input;
    const block = Number(input.block);
    const out = yield* Output;
    const { networkId } = environmentOf(network);
    const scripts = yield* bridgeScripts;
    const utxos = yield* bridgeUtxos(scripts, networkId);
    const threshold = yield* beefyThresholdAt(utxos.threshold);
    const at = yield* blockHash(rpc, block);
    const proof = yield* justificationAt(rpc, block, at);
    const set = yield* validatorSetAt(rpc, at);
    const { leaf, proof: leafProof } = yield* leafProofAt(rpc, block, at);
    const justified = yield* Either.mapLeft(
      updateFromJustification(block, proof, set, leaf, leafProof, threshold),
      (refusal) =>
        new PreconditionFailed({
          command: "bridge-fetch-justification",
          refusal,
        }),
    );
    const json = yield* Effect.orDie(
      Schema.encode(BridgeUpdateJson)(justified.update),
    );
    const path = txFilePath(input);
    yield* out.writeJson(path, json);
    yield* Effect.forEach(
      [
        `\nBEEFY justification of Midnight block ${block} from ${rpc}`,
        `  Signed by set ${proof.validatorSetId}: ${justified.signers} of ${justified.keys} keys, ${justified.seats} of ${justified.seatCount} seats (the threshold ${threshold.numerator}/${threshold.denominator} needs ${justified.required})`,
        `  Leaf: parent ${leaf.parentNumber}, names set ${leaf.nextAuthoritySet.validator_set_id} (${leaf.nextAuthoritySet.seat_count} seats)`,
        `  MMR proof: ${leafProof.items.length} items, leaf ${block - 1} of ${block}`,
      ],
      (line) => out.log(line),
      { discard: true },
    );
    yield* out.success(`BridgeUpdate written to ${path}`);
  });

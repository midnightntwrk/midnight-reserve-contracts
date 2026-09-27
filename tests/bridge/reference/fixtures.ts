/**
 * The MIP §Test vectors committee (three keys, seats `(1, 2, 1)`) and the
 * signed scenarios `lib/bridge/vectors.ak` carries. Filler leaf `i` is
 * `keccak(u32le(i))`; the signed leaf is the last one and names a successor
 * committee of 9 seats under a keyset that is not the signing one.
 */
import { concatBytes } from "@noble/hashes/utils.js";
import { committeeCommitment, type Member } from "./commitment";
import { keccak } from "../../../cli/bridge/keccak";
import { u32le } from "../../../cli/bridge/scale";
import { Mmr } from "./mmr";
import {
  encodeCommitment,
  encodeLeaf,
  type Commitment,
  type MmrLeaf,
} from "./scale";
import { byKey, keypair, sign, type Keypair } from "./sign";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

export const keypairs: Keypair[] = [1n, 2n, 3n].map(keypair).sort(byKey);

export const seats = [1, 2, 1];

export const members: Member[] = keypairs.map((kp, i) => ({
  key: kp.public,
  seats: seats[i],
}));

export const committee = committeeCommitment(0n, members);

export const keysetRoot = committee.commitment.keysetCommitment;

export const dummyLeafHash = (i: number): Uint8Array => keccak(u32le(i));

export const parentHash = (block: number): Uint8Array =>
  keccak(concatBytes(text("parent"), u32le(block)));

const nextKeyset = (id: bigint): Uint8Array =>
  keccak(concatBytes(text("next"), u32le(Number(id))));

/** The successor committee a scenario's leaf names. */
export const leafNext = (id: bigint): Commitment => ({
  validatorSetId: id,
  seatCount: 9,
  keysetCommitment: nextKeyset(id),
});

export type Scenario = {
  name: string;
  setId: bigint;
  blockNumber: number;
  nextId: bigint;
  parentHash: Uint8Array;
  leaf: MmrLeaf;
  mmr: Mmr;
  mmrRoot: Uint8Array;
  msgHash: Uint8Array;
  /** One signature per committee key, key order. */
  sigs: Uint8Array[];
};

/** `parentNumber` defaults to `blockNumber - 1`; `g_wrong_parent` commits a leaf that breaks rule 7 only. */
export function scenario(
  name: string,
  setId: bigint,
  blockNumber: number,
  nextId: bigint,
  parentNumber = blockNumber - 1,
): Scenario {
  const ph = parentHash(blockNumber);
  const leaf: MmrLeaf = {
    parentNumber,
    parentHash: ph,
    nextAuthoritySet: leafNext(nextId),
  };
  const hashes = Array.from({ length: blockNumber - 1 }, (_, i) =>
    dummyLeafHash(i),
  );
  hashes.push(keccak(encodeLeaf(leaf)));
  const mmr = new Mmr(hashes);
  const mmrRoot = mmr.root();
  const msgHash = keccak(encodeCommitment(mmrRoot, blockNumber, setId));
  return {
    name,
    setId,
    blockNumber,
    nextId,
    parentHash: ph,
    leaf,
    mmr,
    mmrRoot,
    msgHash,
    sigs: keypairs.map((kp) => sign(kp, msgHash)),
  };
}

export const scenarios: Scenario[] = [
  scenario("a_no_handover", 4n, 7, 5n),
  scenario("b_handover", 5n, 8, 6n),
  scenario("c_next_signs_same", 5n, 8, 5n),
  scenario("d_skip_two", 4n, 7, 7n),
  scenario("e_block_one", 4n, 1, 5n),
  scenario("f_current_hands_over", 4n, 9, 6n),
  scenario("g_wrong_parent", 4n, 7, 5n, 7),
];

/** `a_no_handover` signature 0 with `s' = n - s`: same `r`, rejected by the low-S builtin. */
export function highSTwin(sig: Uint8Array): Uint8Array {
  const n = BigInt(
    "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
  );
  const s = BigInt("0x" + Buffer.from(sig.subarray(32)).toString("hex"));
  const high = (n - s).toString(16).padStart(64, "0");
  return new Uint8Array([...sig.subarray(0, 32), ...Buffer.from(high, "hex")]);
}

export const scenarioByName = (name: string): Scenario => {
  const s = scenarios.find((x) => x.name === name);
  if (!s) throw new Error(`no scenario ${name}`);
  return s;
};

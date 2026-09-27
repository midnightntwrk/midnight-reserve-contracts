/**
 * A committee's authority set as the light client verifies it (MIP
 * §Committee commitment, rules 3 and 6): the 37-byte leaf `key ‖ seats`,
 * the seats a quorum needs, and the multiproof revealing the signers'
 * leaves. The multiproof has the five node shapes `lib/bridge/merkle.ak`
 * walks (`[leaf]`, `[leaf, leaf]`, `[hash, tree]`, `[tree, hash]`,
 * `[tree, tree]`): a signer's leaf appears raw, everything else as a hash.
 * The tree is split at the largest power of two below the size, which is
 * the shape `binary_merkle_tree::merkle_root` produces.
 */
import { PlutusData, PlutusList } from "@blaze-cardano/core";
import { concatBytes } from "@noble/hashes/utils.js";
import { keccak, merge } from "./keccak";
import { u32le } from "./scale";

/** `key (33) ‖ seats (u32 LE)`. */
export function authorityLeaf(key: Uint8Array, seats: number): Uint8Array {
  return concatBytes(key, u32le(seats));
}

/** Seats a quorum needs: `seat_count − ⌊(seat_count − 1)(d − n) / d⌋`. */
export function required(
  seatCount: number,
  numerator: number,
  denominator: number,
): number {
  return (
    seatCount -
    Math.floor(((seatCount - 1) * (denominator - numerator)) / denominator)
  );
}

export type ProofNode = Uint8Array | ProofNode[];

type Built = {
  node: ProofNode;
  hash: Uint8Array;
  kind: "hashed" | "leaf" | "tree";
};

function pow2Below(n: number): number {
  let a = 1;
  while (a * 2 < n) a *= 2;
  return a;
}

function build(
  leaves: readonly Uint8Array[],
  signers: ReadonlySet<number>,
  offset: number,
): Built {
  if (leaves.length === 1) {
    const leaf = leaves[0];
    const hash = keccak(leaf);
    return signers.has(offset)
      ? { node: leaf, hash, kind: "leaf" }
      : { node: hash, hash, kind: "hashed" };
  }
  const k = pow2Below(leaves.length);
  const left = build(leaves.slice(0, k), signers, offset);
  const right = build(leaves.slice(k), signers, offset + k);
  const hash = merge(left.hash, right.hash);
  if (left.kind === "hashed" && right.kind === "hashed")
    return { node: hash, hash, kind: "hashed" };
  const wrap = (b: Built, other: Built): ProofNode =>
    b.kind === "leaf" && other.kind !== "leaf" ? [b.node] : b.node;
  return { node: [wrap(left, right), wrap(right, left)], hash, kind: "tree" };
}

/** Multiproof over `leaves` (tree order) revealing the leaves at `signers`; at least one signer. */
export function buildMultiproof(
  leaves: readonly Uint8Array[],
  signers: ReadonlySet<number>,
): ProofNode {
  const root = build(leaves, signers, 0);
  return root.kind === "leaf" ? [root.node] : root.node;
}

export function toPlutusData(node: ProofNode): PlutusData {
  if (!Array.isArray(node)) return PlutusData.newBytes(node);
  const list = new PlutusList();
  for (const child of node) list.add(toPlutusData(child));
  return PlutusData.newList(list);
}

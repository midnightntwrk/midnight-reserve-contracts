/**
 * Authority-set multiproof: the five node shapes `lib/bridge/merkle.ak`
 * walks (`[leaf]`, `[leaf, leaf]`, `[hash, tree]`, `[tree, hash]`,
 * `[tree, tree]`). A signer's leaf appears raw, everything else as a hash.
 * The tree is split at the largest power of two below the size, which is the
 * shape `binary_merkle_tree::merkle_root` produces.
 */
import { PlutusData, PlutusList } from "@blaze-cardano/core";
import { bytesToHex } from "@noble/hashes/utils.js";
import { keccak, merge } from "./keccak";

export type ProofNode = Uint8Array | ProofNode[];

export type ProofNodeJson = string | ProofNodeJson[];

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
  if (signers.size === 0) throw new Error("a multiproof needs a signer");
  const root = build(leaves, signers, 0);
  return root.kind === "leaf" ? [root.node] : root.node;
}

/** Port of the Aiken walk: root hash and revealed leaves in tree order. */
export function walkMultiproof(node: ProofNode): {
  root: Uint8Array;
  leaves: Uint8Array[];
} {
  if (!Array.isArray(node)) throw new Error("multiproof root must be a list");
  const leaves: Uint8Array[] = [];
  const go = (n: ProofNode[]): Uint8Array => {
    if (n.length === 1) {
      const leaf = n[0];
      if (Array.isArray(leaf)) throw new Error("bad shape: [tree]");
      leaves.push(leaf);
      return keccak(leaf);
    }
    if (n.length !== 2) throw new Error(`bad shape: ${n.length} items`);
    const [a, b] = n;
    if (Array.isArray(a) && Array.isArray(b)) {
      const ha = go(a);
      const hb = go(b);
      return merge(ha, hb);
    }
    if (Array.isArray(a)) return merge(go(a), b as Uint8Array);
    if (Array.isArray(b)) return merge(a, go(b));
    leaves.push(a, b);
    return merge(keccak(a), keccak(b));
  };
  return { root: go(node), leaves };
}

export function toPlutusData(node: ProofNode): PlutusData {
  if (!Array.isArray(node)) return PlutusData.newBytes(node);
  const list = new PlutusList();
  for (const child of node) list.add(toPlutusData(child));
  return PlutusData.newList(list);
}

export function toJson(node: ProofNode): ProofNodeJson {
  return Array.isArray(node) ? node.map(toJson) : bytesToHex(node);
}

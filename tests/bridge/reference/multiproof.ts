/** The Aiken multiproof walk ported to TypeScript, and the multiproof as JSON. */
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ProofNode } from "../../../cli/bridge/authority-set";
import { keccak, merge } from "../../../cli/bridge/keccak";

type ProofNodeJson = string | ProofNodeJson[];

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

export function toJson(node: ProofNode): ProofNodeJson {
  return Array.isArray(node) ? node.map(toJson) : bytesToHex(node);
}

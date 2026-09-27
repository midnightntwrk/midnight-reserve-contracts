/** Keccak-256 and the node merge of the bridge's Merkle trees. */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { concatBytes } from "@noble/hashes/utils.js";

export const keccak = (b: Uint8Array): Uint8Array => keccak_256(b);

export const merge = (l: Uint8Array, r: Uint8Array): Uint8Array =>
  keccak(concatBytes(l, r));

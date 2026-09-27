/** The `binary_merkle_tree::merkle_root` layering. */
import { merge } from "../../../cli/bridge/keccak";

/** Pair each layer left to right; an unpaired last node is promoted unchanged. */
export function merkleRoot(hashes: readonly Uint8Array[]): Uint8Array {
  if (hashes.length === 0) throw new Error("merkle_root of no leaves");
  let layer = [...hashes];
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < layer.length; i += 2)
      next.push(merge(layer[i], layer[i + 1]));
    if (layer.length % 2 === 1) next.push(layer[layer.length - 1]);
    layer = next;
  }
  return layer[0];
}

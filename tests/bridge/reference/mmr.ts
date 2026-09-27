/**
 * Merkle mountain range as `polkadot-ckb-merkle-mountain-range` 0.8.2 builds
 * it for `pallet-mmr`: keccak-256, `H(left ‖ right)` inside a peak, peaks
 * bagged right to left as `H(right ‖ left)`. `proof(i)` returns
 * `LeafProof.items` in `gen_proof` order: one hash per peak left of the
 * leaf's peak, the climb siblings bottom-up, then one bagged item for the
 * right peaks when any exist.
 */
import { merge } from "../../../cli/bridge/keccak";

/** Peak sizes by descending height: the set bits of `count`. */
function peakSizes(count: number): number[] {
  const sizes: number[] = [];
  for (let size = 1 << 30; size >= 1; size >>= 1)
    if (count & size) sizes.push(size);
  return sizes;
}

function treeRoot(hashes: readonly Uint8Array[]): Uint8Array {
  if (hashes.length === 1) return hashes[0];
  const half = hashes.length / 2;
  return merge(treeRoot(hashes.slice(0, half)), treeRoot(hashes.slice(half)));
}

/** Siblings bottom-up for `offset` inside a full tree. */
function siblings(hashes: readonly Uint8Array[], offset: number): Uint8Array[] {
  if (hashes.length === 1) return [];
  const half = hashes.length / 2;
  const left = hashes.slice(0, half);
  const right = hashes.slice(half);
  return offset < half
    ? [...siblings(left, offset), treeRoot(right)]
    : [...siblings(right, offset - half), treeRoot(left)];
}

/** `acc = H(acc ‖ next_left)` from the rightmost peak. */
function bag(peaksLeftToRight: readonly Uint8Array[]): Uint8Array {
  if (peaksLeftToRight.length === 0) throw new Error("bag of no peaks");
  const [right, ...lefts] = [...peaksLeftToRight].reverse();
  return lefts.reduce((acc, left) => merge(acc, left), right);
}

export class Mmr {
  constructor(readonly leafHashes: readonly Uint8Array[]) {
    if (leafHashes.length === 0) throw new Error("empty MMR");
  }

  peaks(): Uint8Array[] {
    const out: Uint8Array[] = [];
    let start = 0;
    for (const size of peakSizes(this.leafHashes.length)) {
      out.push(treeRoot(this.leafHashes.slice(start, start + size)));
      start += size;
    }
    return out;
  }

  root(): Uint8Array {
    return bag(this.peaks());
  }

  proof(index: number): Uint8Array[] {
    if (index < 0 || index >= this.leafHashes.length)
      throw new Error(`leaf ${index} out of range`);
    const peaks = this.peaks();
    let start = 0;
    let p = 0;
    for (const size of peakSizes(this.leafHashes.length)) {
      if (index < start + size) {
        const items = [
          ...peaks.slice(0, p),
          ...siblings(
            this.leafHashes.slice(start, start + size),
            index - start,
          ),
        ];
        const rights = peaks.slice(p + 1);
        return rights.length ? [...items, bag(rights)] : items;
      }
      start += size;
      p++;
    }
    throw new Error("unreachable");
  }
}

/** Index-walk verifier, the `lib/bridge/merkle.ak` algorithm; every item must be consumed. */
function leafRoot(
  leafHash: Uint8Array,
  index: number,
  count: number,
  items: readonly Uint8Array[],
): Uint8Array {
  if (index < 0 || index >= count) throw new Error("index out of range");
  let rest = [...items];
  const take = (): Uint8Array => {
    const item = rest.shift();
    if (item === undefined) throw new Error("proof too short");
    return item;
  };
  const rightmostFirst: Uint8Array[] = [];
  let remaining = count;
  let offset = index;
  for (const size of peakSizes(count)) {
    if (offset >= size) {
      rightmostFirst.unshift(take());
      remaining -= size;
      offset -= size;
      continue;
    }
    let hash = leafHash;
    for (let levels = size; levels > 1; levels >>= 1) {
      const sibling = take();
      hash = offset % 2 === 1 ? merge(sibling, hash) : merge(hash, sibling);
      offset = Math.floor(offset / 2);
    }
    if (remaining === size) {
      if (rest.length) throw new Error("proof too long");
      rightmostFirst.unshift(hash);
    } else {
      if (rest.length !== 1) throw new Error("expected one bagged right item");
      rightmostFirst.unshift(hash);
      rightmostFirst.unshift(rest[0]);
    }
    const [right, ...lefts] = rightmostFirst;
    return lefts.reduce((acc, left) => merge(acc, left), right);
  }
  throw new Error("unreachable");
}

export function verifyMmrLeaf(
  root: Uint8Array,
  leafHash: Uint8Array,
  index: number,
  count: number,
  items: readonly Uint8Array[],
): boolean {
  try {
    return Buffer.compare(leafRoot(leafHash, index, count, items), root) === 0;
  } catch {
    return false;
  }
}

/**
 * The Substrate V1 extrinsics trie (sp_trie LayoutV1, blake2b-256) that a
 * block header's extrinsics_root commits to: the trie of a block's
 * extrinsics keyed by Compact(index), its root, and the root-first proof of
 * one index that lib/rewards/trie.ak verifies. A port of
 * lib/rewards/trie_builder.ak.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { concatBytes } from "@noble/hashes/utils.js";

type Node =
  | {
      readonly kind: "leaf";
      readonly partial: number[];
      readonly value: Uint8Array;
    }
  | {
      readonly kind: "branch";
      readonly partial: number[];
      readonly children: (Node | undefined)[];
    };

const hash = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 });

/** SCALE Compact(n) for n below 2^30. */
export const compactEncode = (n: number): Uint8Array =>
  n < 64
    ? Uint8Array.of(n << 2)
    : n < 16384
      ? Uint8Array.of(((n << 2) | 1) & 0xff, n >> 6)
      : Uint8Array.of(
          ((n << 2) | 2) & 0xff,
          (n >> 6) & 0xff,
          (n >> 14) & 0xff,
          (n >> 22) & 0xff,
        );

const nibbles = (bytes: Uint8Array): number[] =>
  [...bytes].flatMap((b) => [b >> 4, b & 15]);

const commonPrefix = (a: number[], b: number[]): number[] => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return a.slice(0, n);
};

const compareNibbles = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
};

const buildSorted = (entries: [number[], Uint8Array][]): Node => {
  if (entries.length === 1) {
    return { kind: "leaf", partial: entries[0][0], value: entries[0][1] };
  }
  const prefix = entries.reduce(
    (acc, [key]) => commonPrefix(acc, key),
    entries[0][0],
  );
  const stripped = entries.map(
    ([key, value]) =>
      [key.slice(prefix.length), value] as [number[], Uint8Array],
  );
  const children = Array.from({ length: 16 }, (_, c) => {
    const group = stripped
      .filter(([key]) => key[0] === c)
      .map(([key, value]) => [key.slice(1), value] as [number[], Uint8Array]);
    return group.length === 0 ? undefined : buildSorted(group);
  });
  return { kind: "branch", partial: prefix, children };
};

/** The trie of `extrinsics`, keyed by Compact(index). */
export const extrinsicsTrie = (extrinsics: readonly Uint8Array[]): Node =>
  buildSorted(
    extrinsics
      .map((xt, i) => [nibbles(compactEncode(i)), xt] as [number[], Uint8Array])
      .sort(([a], [b]) => compareNibbles(a, b)),
  );

const header = (kind: number, partial: number[]): Uint8Array => {
  const padded = partial.length % 2 === 1 ? [0, ...partial] : partial;
  const packed = Uint8Array.from(
    { length: padded.length / 2 },
    (_, i) => padded[2 * i] * 16 + padded[2 * i + 1],
  );
  return concatBytes(Uint8Array.of(kind + partial.length), packed);
};

const encode = (node: Node): Uint8Array => {
  if (node.kind === "leaf") {
    return node.value.length >= 33
      ? concatBytes(header(32, node.partial), hash(node.value))
      : concatBytes(
          header(64, node.partial),
          compactEncode(node.value.length),
          node.value,
        );
  }
  const bitmap = node.children.reduce(
    (acc, child, i) => (child === undefined ? acc : acc | (1 << i)),
    0,
  );
  return concatBytes(
    header(128, node.partial),
    Uint8Array.of(bitmap & 0xff, bitmap >> 8),
    ...node.children.flatMap((child) =>
      child === undefined ? [] : [reference(child)],
    ),
  );
};

const reference = (node: Node): Uint8Array => {
  const bytes = encode(node);
  return bytes.length < 32
    ? concatBytes(compactEncode(bytes.length), bytes)
    : concatBytes(compactEncode(32), hash(bytes));
};

/** The trie's root: blake2b-256 of the root node. */
export const trieRoot = (node: Node): Uint8Array => hash(encode(node));

/** The hash-referenced nodes on the path to Compact(index), root first. */
export const trieProof = (node: Node, index: number): Uint8Array[] => {
  const path = (at: Node, key: number[], hashed: boolean): Uint8Array[] => {
    const here = hashed ? [encode(at)] : [];
    if (at.kind === "leaf") return here;
    const [c, ...rest] = key.slice(at.partial.length);
    const child = at.children[c]!;
    return [...here, ...path(child, rest, encode(child).length >= 32)];
  };
  return path(node, nibbles(compactEncode(index)), true);
};

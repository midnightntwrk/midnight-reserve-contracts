/**
 * The rewards pallet's storage as the pump reads it: the Twox keys of
 * `BlockRewards::EpochLeaves` and `BlockRewards::DigestBlock` (maps
 * `Twox64Concat` over the epoch, u64 LE), and their SCALE values. XXH64 is
 * ported here; twox128 is XXH64 with seeds 0 and 1, each little-endian.
 */
import { bytesToHex, concatBytes } from "@noble/hashes/utils.js";

const MASK = (1n << 64n) - 1n;
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;

const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (64n - r))) & MASK;
const u64At = (b: Uint8Array, i: number) =>
  new DataView(b.buffer, b.byteOffset).getBigUint64(i, true);
const u32At = (b: Uint8Array, i: number) =>
  BigInt(new DataView(b.buffer, b.byteOffset).getUint32(i, true));
const round = (acc: bigint, lane: bigint) =>
  (rotl((acc + lane * P2) & MASK, 31n) * P1) & MASK;
const merge = (acc: bigint, v: bigint) =>
  ((acc ^ round(0n, v)) * P1 + P4) & MASK;

/** XXH64 of `input` under `seed`. */
export const xxh64 = (input: Uint8Array, seed: bigint): bigint => {
  let i = 0;
  let h: bigint;
  if (input.length >= 32) {
    let v = [
      (seed + P1 + P2) & MASK,
      (seed + P2) & MASK,
      seed,
      (seed - P1) & MASK,
    ];
    for (; i + 32 <= input.length; i += 32)
      v = v.map((acc, lane) => round(acc, u64At(input, i + 8 * lane)));
    h =
      (rotl(v[0], 1n) + rotl(v[1], 7n) + rotl(v[2], 12n) + rotl(v[3], 18n)) &
      MASK;
    h = v.reduce(merge, h);
  } else {
    h = (seed + P5) & MASK;
  }
  h = (h + BigInt(input.length)) & MASK;
  for (; i + 8 <= input.length; i += 8)
    h = (rotl(h ^ round(0n, u64At(input, i)), 27n) * P1 + P4) & MASK;
  if (i + 4 <= input.length) {
    h = (rotl(h ^ ((u32At(input, i) * P1) & MASK), 23n) * P2 + P3) & MASK;
    i += 4;
  }
  for (; i < input.length; i++)
    h = (rotl(h ^ ((BigInt(input[i]) * P5) & MASK), 11n) * P1) & MASK;
  h = ((h ^ (h >> 33n)) * P2) & MASK;
  h = ((h ^ (h >> 29n)) * P3) & MASK;
  return h ^ (h >> 32n);
};

const le64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

/** Twox128: XXH64 seeds 0 and 1, little-endian, concatenated. */
export const twox128 = (input: Uint8Array): Uint8Array =>
  concatBytes(le64(xxh64(input, 0n)), le64(xxh64(input, 1n)));

const text = (s: string) => new TextEncoder().encode(s);

/** The key of `BlockRewards::<item>[epoch]`: twox128 of pallet and item, then Twox64Concat of the epoch (u64 LE). */
export const epochKey = (
  item: "EpochLeaves" | "DigestBlock",
  epoch: bigint,
): string => {
  const e = le64(epoch);
  return `0x${bytesToHex(
    concatBytes(
      twox128(text("BlockRewards")),
      twox128(text(item)),
      le64(xxh64(e, 0n)),
      e,
    ),
  )}`;
};

/** `Vec<[u8; 45]>`: a SCALE compact count, then the leaves. */
export const decodeEpochLeaves = (bytes: Uint8Array): Uint8Array[] => {
  const mode = bytes[0] & 3;
  const [count, at] =
    mode === 0
      ? [bytes[0] >> 2, 1]
      : mode === 1
        ? [(bytes[0] | (bytes[1] << 8)) >> 2, 2]
        : [
            new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) >>>
              2,
            4,
          ];
  return Array.from({ length: count }, (_, i) =>
    bytes.slice(at + 45 * i, at + 45 * (i + 1)),
  );
};

/** `DigestBlock`: the block number, u32 LE. */
export const decodeDigestBlock = (bytes: Uint8Array): number =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);

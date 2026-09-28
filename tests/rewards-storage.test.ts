/**
 * The rewards pallet's storage keys and values as the pump reads them:
 * XXH64 against its published vectors, twox128 against the pallet
 * prefixes the node reports, the Twox64Concat epoch key, and the SCALE
 * decoders.
 */
import { describe, expect, test } from "bun:test";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import {
  decodeDigestBlock,
  decodeEpochLeaves,
  epochKey,
  twox128,
  xxh64,
} from "../cli/rewards/storage";

const text = (s: string) => new TextEncoder().encode(s);

describe("xxh64", () => {
  test.each([
    ["", "ef46db3751d8e999"],
    ["Nobody inspects the spammish repetition", "fbcea83c8a378bf1"],
  ])("%p hashes to %s", (input, hash) => {
    expect(xxh64(text(input), 0n).toString(16)).toBe(hash);
  });
});

describe("twox128", () => {
  test.each([
    ["System", "26aa394eea5630e07c48ae0c9558cef7"],
    ["BlockRewards", "c2ad8813901dcccdf6f4b6ce11257734"],
    ["EpochLeaves", "c247b09e906dd7138bef6d89ca3b2825"],
    ["DigestBlock", "d7e4953448e1320257f553fd3e0a906e"],
  ])("%s is the node's prefix %s", (name, prefix) => {
    expect(bytesToHex(twox128(text(name)))).toBe(prefix);
  });
});

describe("epochKey", () => {
  test("is the pallet and item prefixes, twox64 of the epoch, then the epoch (u64 LE)", () => {
    const key = epochKey("DigestBlock", 5n);
    expect(key.slice(0, 66)).toBe(
      "0xc2ad8813901dcccdf6f4b6ce11257734d7e4953448e1320257f553fd3e0a906e",
    );
    expect(key.slice(66, 82)).toBe(
      bytesToHex(
        new Uint8Array(
          new BigUint64Array([xxh64(hexToBytes("0500000000000000"), 0n)])
            .buffer,
        ),
      ),
    );
    expect(key.slice(82)).toBe("0500000000000000");
  });
});

describe("decoders", () => {
  const leaf = (b: number) => new Uint8Array(45).fill(b);

  test("EpochLeaves: a one-byte compact count", () => {
    expect(
      decodeEpochLeaves(concatBytes(Uint8Array.of(2 << 2), leaf(1), leaf(2))),
    ).toEqual([leaf(1), leaf(2)]);
  });

  test("EpochLeaves: a two-byte compact count", () => {
    const leaves = Array.from({ length: 70 }, (_, i) => leaf(i));
    expect(
      decodeEpochLeaves(
        concatBytes(Uint8Array.of(((70 << 2) | 1) & 0xff, 70 >> 6), ...leaves),
      ),
    ).toEqual(leaves);
  });

  test("DigestBlock: u32 LE", () => {
    expect(decodeDigestBlock(hexToBytes("39050000"))).toBe(1337);
  });
});

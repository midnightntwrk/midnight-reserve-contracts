/**
 * The registration's boundary pieces: the destination weights and the
 * operator claim the rewards pallet checks (a sidechain key's prehashed
 * ECDSA signature, r ‖ s ‖ recovery id, over Blake2b-256 of the domain and
 * the stake key hash).
 */
import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { Either } from "effect";
import { operatorClaim, parseDestinations } from "../cli/rewards/register";

describe("parseDestinations", () => {
  test("weights summing to 1000", () => {
    expect(parseDestinations("00aa:600,01bbcc:400")).toEqual(
      Either.right({ "00aa": 600n, "01bbcc": 400n }),
    );
  });

  test.each([
    "00aa:999",
    "00aa:0,01bb:1000",
    "0a:1000x",
    "0:1000",
    "00AA:1000",
  ])("refuses %s", (text) => {
    expect(Either.isLeft(parseDestinations(text))).toBe(true);
  });
});

describe("operatorClaim", () => {
  const secret = hexToBytes("11".repeat(32));
  const skh = "ab".repeat(28);
  const claim = operatorClaim(secret, skh);
  const key = claim[bytesToHex(new TextEncoder().encode("sidechain"))];
  const sig = hexToBytes(
    claim[bytesToHex(new TextEncoder().encode("sidechain_sig"))],
  );
  const digest = blake2b(
    concatBytes(
      new TextEncoder().encode("midnight:rewards-operator"),
      hexToBytes(skh),
    ),
    { dkLen: 32 },
  );

  test("carries the 33-byte compressed key", () => {
    expect(key).toBe(bytesToHex(secp256k1.getPublicKey(secret, true)));
  });

  test("the 65-byte signature is r ‖ s ‖ recovery id and recovers the key from the digest", () => {
    expect(sig.length).toBe(65);
    const recovered = secp256k1.Signature.fromBytes(
      concatBytes(sig.slice(64), sig.slice(0, 64)),
      "recovered",
    ).recoverPublicKey(digest);
    expect(bytesToHex(recovered.toBytes(true))).toBe(key);
  });

  test("a claim over another stake key hash does not verify", () => {
    const other = blake2b(
      concatBytes(
        new TextEncoder().encode("midnight:rewards-operator"),
        hexToBytes("cd".repeat(28)),
      ),
      { dkLen: 32 },
    );
    expect(
      secp256k1.verify(sig.slice(0, 64), other, hexToBytes(key), {
        prehash: false,
      }),
    ).toBe(false);
  });
});

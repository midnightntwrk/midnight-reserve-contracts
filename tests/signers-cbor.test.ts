import { describe, test, expect } from "bun:test";
import {
  createMultisigStateCbor,
  extractSignersFromCbor,
  createRedeemerMapCbor,
} from "../cli-yargs/lib/signers";
import type { Signer } from "../cli-yargs/lib/types";

/**
 * Generate deterministic fake signers for testing.
 * Each signer gets a unique 28-byte payment hash and 32-byte sr25519 key.
 */
function generateSigners(count: number): Signer[] {
  const signers: Signer[] = [];
  for (let i = 0; i < count; i++) {
    const paymentHash = i.toString(16).padStart(56, "0");
    const sr25519Key = (i + 0x1000).toString(16).padStart(64, "0");
    signers.push({ paymentHash, sr25519Key });
  }
  return signers;
}

describe("CBOR signer encoding/decoding", () => {
  test("round-trips 23 signers (max inline map header 0xb7)", () => {
    const signers = generateSigners(23);
    const datum = createMultisigStateCbor(signers);
    const extracted = extractSignersFromCbor(datum);

    expect(extracted).toHaveLength(23);
    for (let i = 0; i < 23; i++) {
      expect(extracted[i].paymentHash).toBe(signers[i].paymentHash);
      expect(extracted[i].sr25519Key).toBe(signers[i].sr25519Key);
    }
  });

  test("round-trips 24 signers (1-byte length map header 0xb8 0x18)", () => {
    const signers = generateSigners(24);
    const datum = createMultisigStateCbor(signers);

    // Verify the raw CBOR uses 0xb8 header for the map before blaze normalizes
    const outerList = datum.asList()!;
    const dataTuple = outerList.get(0).asList()!;
    const mapCbor = Buffer.from(dataTuple.get(1).toCbor(), "hex");
    expect(mapCbor[0]).toBe(0xb8);
    expect(mapCbor[1]).toBe(24);

    const extracted = extractSignersFromCbor(datum);
    expect(extracted).toHaveLength(24);
    for (let i = 0; i < 24; i++) {
      expect(extracted[i].paymentHash).toBe(signers[i].paymentHash);
      expect(extracted[i].sr25519Key).toBe(signers[i].sr25519Key);
    }
  });

  test("preserves explicit totalSigners for 25-signer map", () => {
    const signers = generateSigners(25);
    const datum = createMultisigStateCbor(signers, 0n, 30n);

    // totalSigners in CBOR should be 30, not 25
    const outerList = datum.asList()!;
    const dataTuple = outerList.get(0).asList()!;
    const totalSignersValue = Number(dataTuple.get(0).asInteger()!);
    expect(totalSignersValue).toBe(30);

    // Map should still have 25 entries
    const mapCbor = Buffer.from(dataTuple.get(1).toCbor(), "hex");
    expect(mapCbor[0]).toBe(0xb8);
    expect(mapCbor[1]).toBe(25);
  });

  test("createRedeemerMapCbor uses 0xb8 header for 25 signers", () => {
    const signers = generateSigners(25);
    const datum = createRedeemerMapCbor(signers);

    // Verify the map uses 0xb8 header
    const cborBytes = Buffer.from(datum.toCbor(), "hex");
    expect(cborBytes[0]).toBe(0xb8);
    expect(cborBytes[1]).toBe(25);
  });
});

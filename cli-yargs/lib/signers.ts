import { HexBlob, PlutusData } from "@blaze-cardano/core";
import type { Signer } from "./types";
import * as Contracts from "../../contract_blueprint";

const HEX_RE = /^[0-9a-fA-F]+$/;

function validateSignerHex(
  paymentHash: string,
  sr25519Key: string,
  context: string,
): void {
  if (paymentHash.length !== 56 || !HEX_RE.test(paymentHash)) {
    throw new Error(
      `${context}: payment hash must be 56 hex characters (28 bytes), got '${paymentHash}'`,
    );
  }
  if (!HEX_RE.test(sr25519Key)) {
    throw new Error(
      `${context}: sr25519 key must be valid hex, got '${sr25519Key}'`,
    );
  }
}

export function parseSigners(envVar: string): Signer[] {
  const signersEnv = process.env[envVar];
  if (!signersEnv) {
    throw new Error(`${envVar} environment variable is required`);
  }

  return signersEnv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((pair) => {
      const [paymentHash, sr25519Key] = pair.split(":").map((s) => s.trim());
      if (!paymentHash || !sr25519Key) {
        throw new Error(`Invalid signer pair: ${pair}`);
      }
      validateSignerHex(paymentHash, sr25519Key, envVar);
      return { paymentHash, sr25519Key };
    });
}

export function parseSignersWithCount(envVar: string): {
  totalSigners: bigint;
  signers: Record<string, string>;
} {
  const signersEnv = process.env[envVar];
  if (!signersEnv) {
    throw new Error(`${envVar} environment variable is required`);
  }

  const signers: Record<string, string> = {};
  const signerPairs = signersEnv.split(",");

  for (const pair of signerPairs) {
    const [paymentHash, sr25519Key] = pair.trim().split(":");
    if (paymentHash && sr25519Key) {
      validateSignerHex(paymentHash, sr25519Key, envVar);
      signers[paymentHash] = sr25519Key;
    }
  }

  const totalSigners = BigInt(Object.keys(signers).length);
  return { totalSigners, signers };
}

export function createMultisigStateFromMap(
  totalSigners: bigint,
  signers: Record<string, string>,
  round: bigint = 0n,
): Contracts.VersionedMultisig {
  // Add CBOR prefix "8200581c" to each key for Multisig state
  const prefixedSigners: Record<string, string> = {};
  for (const [hash, sr25519Key] of Object.entries(signers)) {
    prefixedSigners["8200581c" + hash] = sr25519Key;
  }
  // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
  return [[totalSigners, prefixedSigners], round];
}

export function parsePrivateKeys(envVar: string): string[] {
  const keysEnv = process.env[envVar];
  if (!keysEnv) {
    throw new Error(`${envVar} environment variable is required`);
  }

  return keysEnv
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * Extracts signers from a raw PlutusData (VersionedMultisig) CBOR, preserving duplicate keys.
 * This is needed because JavaScript's Record type deduplicates keys, but CBOR maps
 * can have duplicate keys which Aiken's builtin.un_map_data preserves.
 */
export function extractSignersFromCbor(datum: PlutusData): Signer[] {
  const signers: Signer[] = [];

  // VersionedMultisig with @list is a plain list: [[totalSigners, signers], round]
  const outerList = datum.asList();
  if (!outerList || outerList.getLength() < 2) {
    throw new Error(
      "Expected list with at least 2 elements for VersionedMultisig",
    );
  }

  // First element is the Multisig tuple [total_signers, signers_map]
  const dataTuple = outerList.get(0).asList();
  if (!dataTuple || dataTuple.getLength() < 2) {
    throw new Error("Data tuple should have at least 2 items");
  }

  // Second item in data tuple is the signers map
  const signersMapData = dataTuple.get(1);
  const signersMap = signersMapData.asMap();
  if (!signersMap) {
    throw new Error("Expected Map for signers");
  }

  // Parse the map CBOR manually to get all entries including duplicates
  // PlutusMap in blaze-cardano may deduplicate, so we parse raw CBOR
  const mapCbor = signersMapData.toCbor();
  const cborBytes = Buffer.from(mapCbor, "hex");
  let offset = 0;

  // Read map header
  const firstByte = cborBytes[offset++];
  let mapLength: number;

  if (firstByte >= 0xa0 && firstByte <= 0xb7) {
    // Map with inline length (0xa0-0xb7, additional info 0-23)
    mapLength = firstByte & 0x1f;
  } else if (firstByte === 0xb8) {
    // Map with 1-byte length
    mapLength = cborBytes[offset++];
  } else if (firstByte === 0xb9) {
    // Map with 2-byte length
    mapLength = (cborBytes[offset++] << 8) | cborBytes[offset++];
  } else if (firstByte === 0xbf) {
    // Indefinite length map - need to count entries
    mapLength = -1;
  } else {
    throw new Error(`Unexpected map header: 0x${firstByte.toString(16)}`);
  }

  // Helper to read a CBOR bytes value
  function readBytes(): string {
    const b = cborBytes[offset++];
    let len: number;

    // CBOR major type 2 (bytes): high 3 bits = 010
    // 0x40-0x57: short bytes with embedded length 0-23
    // 0x58: 1-byte length follows
    // 0x59: 2-byte length follows
    if (b >= 0x40 && b <= 0x57) {
      // Short bytes (0x40-0x57)
      len = b & 0x1f;
    } else if (b === 0x58) {
      // Bytes with 1-byte length
      len = cborBytes[offset++];
    } else if (b === 0x59) {
      // Bytes with 2-byte length
      len = (cborBytes[offset++] << 8) | cborBytes[offset++];
    } else {
      throw new Error(`Expected bytes, got 0x${b.toString(16)}`);
    }

    const data = cborBytes.subarray(offset, offset + len);
    offset += len;
    return data.toString("hex");
  }

  // Read map entries
  let entriesRead = 0;
  while (
    mapLength === -1 ? cborBytes[offset] !== 0xff : entriesRead < mapLength
  ) {
    // Key is bytes with "8200581c<paymentHash>" format
    const keyHex = readBytes();
    // Value is bytes with sr25519Key
    const valueHex = readBytes();

    // Extract payment hash from key (remove "8200581c" prefix)
    const paymentHash = keyHex.slice(8);
    const sr25519Key = valueHex;

    signers.push({ paymentHash, sr25519Key });
    entriesRead++;
  }

  return signers;
}

/**
 * Creates a VersionedMultisig datum as raw PlutusData CBOR.
 * This function supports duplicate payment hashes (same signer multiple times)
 * by manually constructing the CBOR map, which preserves duplicate keys.
 *
 * Standard JS objects/Records would deduplicate keys, but CBOR maps allow duplicates
 * and Aiken's builtin.un_map_data preserves them as separate pairs.
 */
export function createMultisigStateCbor(
  signers: Signer[],
  round: bigint = 0n,
  totalSigners?: bigint,
): PlutusData {
  // Build map entries with duplicate keys preserved
  // CBOR map format: A<n> (where n is count) followed by key-value pairs
  const mapEntries: Buffer[] = [];

  for (const signer of signers) {
    // Key: "8200581c" + paymentHash (as bytes)
    const keyHex = `8200581c${signer.paymentHash}`;
    const keyBytes = Buffer.from(keyHex, "hex");
    // CBOR bytes encoding: 58 <length> <data> for lengths > 23
    const keyEncoded = Buffer.concat([
      Buffer.from([0x58, keyBytes.length]),
      keyBytes,
    ]);

    // Value: sr25519Key (as bytes)
    const valueBytes = Buffer.from(signer.sr25519Key, "hex");
    const valueEncoded = Buffer.concat([
      Buffer.from([0x58, valueBytes.length]),
      valueBytes,
    ]);

    mapEntries.push(keyEncoded, valueEncoded);
  }

  // Map header: A0-B7 for small maps, or more complex encoding for larger
  let mapHeader: Buffer;
  if (signers.length <= 23) {
    mapHeader = Buffer.from([0xa0 + signers.length]);
  } else if (signers.length <= 255) {
    mapHeader = Buffer.from([0xb8, signers.length]);
  } else {
    throw new Error("Too many signers for simple CBOR encoding");
  }

  const mapCbor = Buffer.concat([mapHeader, ...mapEntries]);

  // VersionedMultisig with @list is a plain CBOR list:
  // 9f          - indefinite array (outer list)
  //   9f        - indefinite array (Multisig tuple)
  //     <int>   - total_signers
  //     <map>   - signers map
  //   ff        - end Multisig array
  //   <int>     - round
  // ff          - end outer array

  // Encode total_signers — use explicit value if provided, otherwise derive from array length
  const totalSignersValue =
    totalSigners !== undefined ? Number(totalSigners) : signers.length;
  let totalSignersEncoded: Buffer;
  if (totalSignersValue <= 23) {
    totalSignersEncoded = Buffer.from([totalSignersValue]);
  } else if (totalSignersValue <= 255) {
    totalSignersEncoded = Buffer.from([0x18, totalSignersValue]);
  } else {
    throw new Error("Too many signers for simple CBOR encoding");
  }

  // Encode round (assuming small values)
  let roundEncoded: Buffer;
  if (round <= 23n) {
    roundEncoded = Buffer.from([Number(round)]);
  } else {
    throw new Error("Round value too large for simple encoding");
  }

  const versionedMultisigCbor = Buffer.concat([
    Buffer.from([0x9f]), // indefinite array (outer list)
    Buffer.from([0x9f]), // indefinite array for Multisig tuple
    totalSignersEncoded, // total_signers
    mapCbor, // signers map with duplicates preserved
    Buffer.from([0xff]), // end Multisig array
    roundEncoded, // round
    Buffer.from([0xff]), // end outer array
  ]);

  return PlutusData.fromCbor(HexBlob(versionedMultisigCbor.toString("hex")));
}

/**
 * Creates a PermissionedRedeemer as raw PlutusData CBOR.
 * This function supports duplicate payment hashes by manually constructing the CBOR map.
 */
export function createRedeemerMapCbor(signers: Signer[]): PlutusData {
  // Build map entries with duplicate keys preserved
  const mapEntries: Buffer[] = [];

  for (const signer of signers) {
    // Key: paymentHash (as bytes, without the 8200581c prefix)
    const keyBytes = Buffer.from(signer.paymentHash, "hex");
    const keyEncoded = Buffer.concat([
      Buffer.from([0x58, keyBytes.length]),
      keyBytes,
    ]);

    // Value: sr25519Key (as bytes)
    const valueBytes = Buffer.from(signer.sr25519Key, "hex");
    const valueEncoded = Buffer.concat([
      Buffer.from([0x58, valueBytes.length]),
      valueBytes,
    ]);

    mapEntries.push(keyEncoded, valueEncoded);
  }

  // Map header
  let mapHeader: Buffer;
  if (signers.length <= 23) {
    mapHeader = Buffer.from([0xa0 + signers.length]);
  } else if (signers.length <= 255) {
    mapHeader = Buffer.from([0xb8, signers.length]);
  } else {
    throw new Error("Too many signers for simple CBOR encoding");
  }

  const mapCbor = Buffer.concat([mapHeader, ...mapEntries]);
  return PlutusData.fromCbor(HexBlob(mapCbor.toString("hex")));
}

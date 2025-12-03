import type { Signer } from "./types";
import * as Contracts from "../../contract_blueprint";

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
      signers[paymentHash] = sr25519Key;
    }
  }

  const totalSigners = BigInt(Object.keys(signers).length);
  return { totalSigners, signers };
}

export function createMultisigState(signers: Signer[]): Contracts.Multisig {
  const signerMap: Record<string, string> = {};
  for (const signer of signers) {
    // Add CBOR prefix "8200581c" to each key for Multisig state
    signerMap[`8200581c${signer.paymentHash}`] = signer.sr25519Key;
  }
  return [BigInt(signers.length), signerMap];
}

export function createMultisigStateFromMap(
  totalSigners: bigint,
  signers: Record<string, string>,
): Contracts.Multisig {
  // Add CBOR prefix "8200581c" to each key for Multisig state
  const prefixedSigners: Record<string, string> = {};
  for (const [hash, sr25519Key] of Object.entries(signers)) {
    prefixedSigners["8200581c" + hash] = sr25519Key;
  }
  return [totalSigners, prefixedSigners];
}

export function createRedeemerMap(
  signers: Signer[],
): Contracts.PermissionedRedeemer {
  const redeemerMap: Record<string, string> = {};
  for (const signer of signers) {
    redeemerMap[signer.paymentHash] = signer.sr25519Key;
  }
  return redeemerMap;
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

export function extractSignersFromMultisigState(
  multisigState: Contracts.Multisig,
): Signer[] {
  const [_threshold, signerMap] = multisigState;
  return Object.entries(signerMap).map(([credHex, sr25519Key]) => {
    // credHex format is "8200581c<hash>" - extract just the hash
    const paymentHash = credHex.slice(8);
    return { paymentHash, sr25519Key };
  });
}

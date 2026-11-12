import { randomBytes } from "crypto";
import {
  Credential,
  CredentialType,
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  Hash28ByteBase16,
  HexBlob,
  blake2b_224,
  addressFromCredential,
  type NetworkId,
} from "@blaze-cardano/core";
import { Effect } from "effect";
import { type Environment, environmentOf } from "../config/network-mapping";
import { Output } from "../output";
import { type NetworkInput } from "../input";

/** A fresh signing key with its address on the given network. */
interface GeneratedKey {
  readonly privateKeyHex: string;
  readonly publicKeyHash: string;
  readonly address: string;
}

/** The key's public key hash and its enterprise address on the network. */
export function keyToAddress(
  privateKeyHex: string,
  networkId: NetworkId,
): GeneratedKey {
  const publicKey = derivePublicKey(Ed25519PrivateNormalKeyHex(privateKeyHex));
  const publicKeyHash = blake2b_224(HexBlob(publicKey));
  const credential = Credential.fromCore({
    type: CredentialType.KeyHash,
    hash: Hash28ByteBase16(publicKeyHash),
  });
  const address = addressFromCredential(networkId, credential);
  return { privateKeyHex, publicKeyHash, address: address.toBech32() };
}

/** Generate a key and print the .env lines for it. */
export const generateKeyProgram = (input: NetworkInput) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const { networkId } = environmentOf(input.network);
    const key = yield* Effect.sync(() =>
      keyToAddress(randomBytes(32).toString("hex"), networkId),
    );
    for (const line of renderGeneratedKey(key, input.network)) {
      yield* output.log(line);
    }
    return key;
  });

function renderGeneratedKey(
  key: GeneratedKey,
  network: Environment,
): readonly string[] {
  return [
    `# Generated Cardano signing key and address`,
    `# Network: ${network}`,
    `# Add these to your .env file:\n`,
    `SIGNING_PRIVATE_KEY=${key.privateKeyHex}`,
    `DEPLOYER_ADDRESS=${key.address}`,
    `\n# Public key hash (for reference):`,
    `# PUBLIC_KEY_HASH=${key.publicKeyHash}`,
  ];
}

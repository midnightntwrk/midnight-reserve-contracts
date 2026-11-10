/** The deployer's wallet: generate-key. */
import { randomBytes } from "crypto";
import {
  addressFromCredential,
  blake2b_224,
  Credential,
  CredentialType,
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  Hash28ByteBase16,
  HexBlob,
  type NetworkId,
} from "@blaze-cardano/core";
import { Effect } from "effect";
import { type Environment, environmentOf } from "./config";
import { Output } from "./output";

/** A signing key's public key hash and its enterprise address on the network. */
export function keyToAddress(privateKeyHex: string, networkId: NetworkId) {
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
export const generateKeyProgram = (input: { readonly network: Environment }) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const key = yield* Effect.sync(() =>
      keyToAddress(
        randomBytes(32).toString("hex"),
        environmentOf(input.network).networkId,
      ),
    );
    for (const line of [
      `# Generated Cardano signing key and address`,
      `# Network: ${input.network}`,
      `# Add these to your .env file:\n`,
      `SIGNING_PRIVATE_KEY=${key.privateKeyHex}`,
      `DEPLOYER_ADDRESS=${key.address}`,
      `\n# Public key hash (for reference):`,
      `# PUBLIC_KEY_HASH=${key.publicKeyHash}`,
    ]) {
      yield* output.log(line);
    }
    return key;
  });

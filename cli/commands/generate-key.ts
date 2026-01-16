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
} from "@blaze-cardano/core";
import { getNetworkId } from "../lib/types";

export interface GenerateKeyOptions {
  /** Environment name (e.g., "preview", "qanet", "node-dev-01") */
  network: string;
}

export async function generateKey(options: GenerateKeyOptions): Promise<void> {
  const { network } = options;
  const networkId = getNetworkId(network);

  const privateKeyBytes = randomBytes(32);
  const privateKeyHex = privateKeyBytes.toString("hex");
  const privateKey = Ed25519PrivateNormalKeyHex(privateKeyHex);

  const publicKey = derivePublicKey(privateKey);
  const publicKeyHash = blake2b_224(HexBlob(publicKey));

  const credential = Credential.fromCore({
    type: CredentialType.KeyHash,
    hash: Hash28ByteBase16(publicKeyHash),
  });

  const address = addressFromCredential(networkId, credential);
  const bech32Address = address.toBech32();

  // Output to terminal for .env usage
  console.log(`# Generated Cardano signing key and address`);
  console.log(`# Network: ${network}`);
  console.log(`# Add these to your .env file:\n`);
  console.log(`SIGNING_PRIVATE_KEY=${privateKeyHex}`);
  console.log(`DEPLOYER_ADDRESS=${bech32Address}`);
  console.log(`\n# Public key hash (for reference):`);
  console.log(`# PUBLIC_KEY_HASH=${publicKeyHash}`);
}

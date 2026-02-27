import type { Argv, CommandModule } from "yargs";
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
import type { GlobalOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";

type GenerateKeyOptions = GlobalOptions;

export const command = "generate-key";
export const describe = "Generate a new signing key and Cardano address";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs;
}

export async function handler(argv: GenerateKeyOptions) {
  const { network } = argv;
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

const commandModule: CommandModule<GlobalOptions, GenerateKeyOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

/**
 * Environment to Cardano Network Mapping
 *
 * This module defines the mapping from Midnight deployment environments to their
 * underlying Cardano networks. This mapping is critical for:
 * - Connecting to the correct Blockfrost/Maestro API endpoints
 * - Using the correct NetworkId (Testnet vs Mainnet) for address generation
 * - Selecting the correct aiken.toml config section
 *
 * ENVIRONMENT → CARDANO NETWORK MAPPING
 * =====================================
 *
 * | Environment          | Cardano Network | Notes                                |
 * |----------------------|-----------------|--------------------------------------|
 * | local                | (emulator)      | Local emulator, no real network      |
 * | preview              | Cardano Preview | Direct mapping                       |
 * | qanet                | Cardano Preview | Midnight QA environment              |
 * | devnet-*             | Cardano Preview | Any devnet (devnet-01, devnet-02...) |
 * | node-dev-*           | Cardano Preview | Node dev envs (node-dev-01, etc.)    |
 * | preprod              | Cardano Preprod | Direct mapping                       |
 * | mainnet              | Cardano Mainnet | Direct mapping                       |
 * | (all others)         | (emulator)      | Unknown environments use emulator    |
 *
 * USAGE
 * =====
 *
 * The `--network` CLI flag accepts environment names. The CLI automatically
 * derives the correct Cardano network for provider connections:
 *
 *   bun cli deploy --network preview     # Uses Cardano Preview
 *   bun cli deploy --network qanet       # Uses Cardano Preview
 *   bun cli deploy --network node-dev-01 # Uses Cardano Preview
 *   bun cli deploy --network preprod     # Uses Cardano Preprod
 *   bun cli deploy --network mainnet     # Uses Cardano Mainnet
 */

import { NetworkId } from "@blaze-cardano/core";

/**
 * Cardano network identifiers for blockchain connections.
 * These correspond to actual Cardano network deployments.
 */
export type CardanoNetwork = "preview" | "preprod" | "mainnet";

/**
 * Maps a deployment environment name to its underlying Cardano network.
 *
 * @param environment - The deployment environment name (e.g., "preview", "qanet", "node-dev-01")
 * @returns The Cardano network to use, or null for local/emulator environments
 *
 * @example
 * getCardanoNetwork("preview")     // => "preview"
 * getCardanoNetwork("qanet")       // => "preview"
 * getCardanoNetwork("node-dev-01") // => "preview"
 * getCardanoNetwork("preprod")     // => "preprod"
 * getCardanoNetwork("mainnet")     // => "mainnet"
 * getCardanoNetwork("local")       // => null (use emulator)
 */
export function getCardanoNetwork(environment: string): CardanoNetwork | null {
  const env = environment.toLowerCase();

  // Direct mappings to Cardano networks
  if (env === "mainnet") return "mainnet";
  if (env === "preprod") return "preprod";
  if (env === "preview") return "preview";

  // Midnight environments that use Cardano Preview
  if (env === "qanet") return "preview";
  if (env.startsWith("devnet-") || env.startsWith("devnet_")) return "preview";
  if (env.startsWith("node-dev-") || env.startsWith("node_dev_")) return "preview";

  // Local/emulator environments
  if (env === "local" || env === "emulator") return null;

  // Unknown environments default to local/emulator with a warning
  console.warn(
    `Warning: Unknown environment '${environment}'. Using local emulator. ` +
      `Known environments: local, preview, qanet, devnet-*, node-dev-*, preprod, mainnet`
  );
  return null;
}

/**
 * Gets the Blaze NetworkId for the given environment.
 *
 * @param environment - The deployment environment name
 * @returns NetworkId.Mainnet for mainnet, NetworkId.Testnet for all others
 */
export function getNetworkIdFromEnvironment(environment: string): NetworkId {
  const cardanoNetwork = getCardanoNetwork(environment);
  return cardanoNetwork === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet;
}

/**
 * Gets the aiken.toml config section name for the given environment.
 *
 * The config section corresponds to the Cardano network, not the Midnight environment:
 * - All Preview environments (preview, qanet, devnet-*, node-dev-*) use [config.preview]
 * - preprod uses [config.preprod]
 * - mainnet uses [config.mainnet]
 * - local uses [config.default]
 *
 * @param environment - The deployment environment name
 * @returns The aiken.toml config section name
 */
export function getAikenConfigSection(environment: string): string {
  const cardanoNetwork = getCardanoNetwork(environment);
  return cardanoNetwork ?? "default";
}

/**
 * Checks if an environment is valid (known) and logs a warning for unknown ones.
 *
 * @param environment - The deployment environment name
 * @returns true if the environment is known, false otherwise
 */
export function isKnownEnvironment(environment: string): boolean {
  const env = environment.toLowerCase();

  const knownPatterns = [
    "local",
    "emulator",
    "preview",
    "qanet",
    "preprod",
    "mainnet",
  ];

  const knownPrefixes = ["devnet-", "devnet_", "node-dev-", "node_dev_"];

  if (knownPatterns.includes(env)) return true;
  if (knownPrefixes.some((prefix) => env.startsWith(prefix))) return true;

  return false;
}

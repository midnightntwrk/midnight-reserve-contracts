import { NetworkId } from "@blaze-cardano/core";

/**
 * Cardano network identifiers for blockchain connections.
 */
export type CardanoNetwork = "preview" | "preprod" | "mainnet";

interface EnvironmentResolution {
  cardanoNetwork: CardanoNetwork | null;
  networkId: NetworkId;
  aikenConfigSection: string;
}

/**
 * Single resolver mapping environment → {cardanoNetwork, networkId, aikenConfigSection}.
 * Supports pattern-based envs: devnet-*, node-dev-*, and underscore variants.
 */
function resolveEnvironment(environment: string): EnvironmentResolution {
  const env = environment.toLowerCase();

  switch (env) {
    case "mainnet":
      return {
        cardanoNetwork: "mainnet",
        networkId: NetworkId.Mainnet,
        aikenConfigSection: "mainnet",
      };
    case "preprod":
      return {
        cardanoNetwork: "preprod",
        networkId: NetworkId.Testnet,
        aikenConfigSection: "preprod",
      };
    case "preview":
      return {
        cardanoNetwork: "preview",
        networkId: NetworkId.Testnet,
        aikenConfigSection: "preview",
      };
    case "qanet":
      return {
        cardanoNetwork: "preview",
        networkId: NetworkId.Testnet,
        aikenConfigSection: "qanet",
      };
    case "govnet":
      return {
        cardanoNetwork: "preview",
        networkId: NetworkId.Testnet,
        aikenConfigSection: "govnet",
      };
    case "node-dev-01":
      return {
        cardanoNetwork: "preview",
        networkId: NetworkId.Testnet,
        aikenConfigSection: "node-dev-01",
      };
    case "node-dev-2":
      return {
        cardanoNetwork: "preview",
        networkId: NetworkId.Testnet,
        aikenConfigSection: "node-dev-2",
      };
    case "local":
    case "emulator":
      return {
        cardanoNetwork: null,
        networkId: NetworkId.Testnet,
        aikenConfigSection: "default",
      };
    default:
      // Pattern-based environments on Cardano Preview
      if (
        env.startsWith("devnet-") ||
        env.startsWith("devnet_") ||
        env.startsWith("node-dev-") ||
        env.startsWith("node_dev_")
      ) {
        return {
          cardanoNetwork: "preview",
          networkId: NetworkId.Testnet,
          aikenConfigSection: "preview",
        };
      }

      console.warn(
        `Warning: Unknown environment '${environment}'. Using local emulator. ` +
          `Known environments: local, preview, qanet, govnet, devnet-*, node-dev-*, preprod, mainnet`,
      );
      return {
        cardanoNetwork: null,
        networkId: NetworkId.Testnet,
        aikenConfigSection: "default",
      };
  }
}

/**
 * Maps a deployment environment name to its underlying Cardano network.
 */
export function getCardanoNetwork(environment: string): CardanoNetwork | null {
  return resolveEnvironment(environment).cardanoNetwork;
}

/**
 * Gets the Blaze NetworkId for the given environment.
 */
export function getNetworkIdFromEnvironment(environment: string): NetworkId {
  return resolveEnvironment(environment).networkId;
}

/**
 * Gets the aiken.toml config section name for the given environment.
 */
export function getAikenConfigSection(environment: string): string {
  return resolveEnvironment(environment).aikenConfigSection;
}

/**
 * Checks if an environment is valid (known).
 */
export function isKnownEnvironment(environment: string): boolean {
  const env = environment.toLowerCase();

  const knownExact = [
    "local",
    "emulator",
    "preview",
    "qanet",
    "govnet",
    "preprod",
    "mainnet",
  ];

  if (knownExact.includes(env)) return true;

  if (
    env.startsWith("devnet-") ||
    env.startsWith("devnet_") ||
    env.startsWith("node-dev-") ||
    env.startsWith("node_dev_")
  ) {
    return true;
  }

  return false;
}

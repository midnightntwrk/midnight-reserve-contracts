import { NetworkId } from "@blaze-cardano/core";

/**
 * Cardano network identifiers for blockchain connections.
 */
export type CardanoNetwork = "preview" | "preprod" | "mainnet" | "local";

interface EnvironmentResolution {
  cardanoNetwork: CardanoNetwork | null;
  networkId: NetworkId;
  aikenConfigSection: string;
}

/**
 * Single resolver mapping environment → {cardanoNetwork, networkId, aikenConfigSection}.
 * Supports pattern-based envs: devnet, and underscore variants.
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
    case "devnet":
      return {
        cardanoNetwork: "preview",
        networkId: NetworkId.Testnet,
        aikenConfigSection: "devnet",
      };
    case "local":
      return {
        cardanoNetwork: "local",
        networkId: NetworkId.Testnet,
        aikenConfigSection: "local",
      };
    case "emulator":
      return {
        cardanoNetwork: null,
        networkId: NetworkId.Testnet,
        aikenConfigSection: "default",
      };
    default:
      // Pattern-based environments on Cardano Preview
      throw new Error(
        `Unknown environment '${environment}'. ` +
          `Known environments: local, emulator, preview, qanet, govnet, devnet, preprod, mainnet`,
      );
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

import { NetworkId } from "@blaze-cardano/core";
import { Option } from "effect";

/** A Cardano network that Blockfrost serves. */
export type PublicNetwork = "preview" | "preprod" | "mainnet";

/** The chain an environment connects to: a public network or a local node. */
export type CardanoNetwork = PublicNetwork | "local";

/** The environments a command runs against, as `--network` takes them. */
export const ENVIRONMENTS = [
  "local",
  "emulator",
  "preview",
  "qanet",
  "govnet",
  "devnet",
  "preprod",
  "mainnet",
] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/** The environments on a test network: every one but mainnet. */
export const TEST_ENVIRONMENTS = ENVIRONMENTS.filter(
  (environment): environment is Exclude<Environment, "mainnet"> =>
    environment !== "mainnet",
);

export type TestEnvironment = (typeof TEST_ENVIRONMENTS)[number];

/** The aiken.toml profiles (`[config.<profile>]`) a build compiles for. */
export const PROFILES = [
  "default",
  "local",
  "preview",
  "qanet",
  "govnet",
  "devnet",
  "preprod",
  "mainnet",
] as const;

export type Profile = (typeof PROFILES)[number];

/** The profiles with a deployed-scripts snapshot. */
export type DeployedProfile = Exclude<Profile, "default" | "local">;

type EnvironmentResolution = {
  readonly networkId: NetworkId;
  /** Promoted validators are permanent here: a deploy may not create one again. */
  readonly production: boolean;
} & (
  | {
      readonly local: false;
      readonly cardanoNetwork: PublicNetwork;
      readonly aikenConfigSection: DeployedProfile;
    }
  | {
      /** Local and the emulator: no public network, no deployed scripts. */
      readonly local: true;
      readonly cardanoNetwork: "local" | null;
      readonly aikenConfigSection: "local" | "default";
    }
);

/** The Cardano network, NetworkId, aiken.toml section and flags of an environment. */
export const environmentOf = (
  environment: Environment,
): EnvironmentResolution => resolutions[environment];

/** The public network of an environment; None on local and the emulator. */
export const publicNetworkOf = (
  environment: Environment,
): Option.Option<PublicNetwork> => {
  const resolution = resolutions[environment];
  return resolution.local
    ? Option.none()
    : Option.some(resolution.cardanoNetwork);
};

const resolutions: Record<Environment, EnvironmentResolution> = {
  mainnet: {
    local: false,
    cardanoNetwork: "mainnet",
    networkId: NetworkId.Mainnet,
    aikenConfigSection: "mainnet",
    production: true,
  },
  preprod: {
    local: false,
    cardanoNetwork: "preprod",
    networkId: NetworkId.Testnet,
    aikenConfigSection: "preprod",
    production: true,
  },
  preview: {
    local: false,
    cardanoNetwork: "preview",
    networkId: NetworkId.Testnet,
    aikenConfigSection: "preview",
    production: false,
  },
  qanet: {
    local: false,
    cardanoNetwork: "preview",
    networkId: NetworkId.Testnet,
    aikenConfigSection: "qanet",
    production: false,
  },
  govnet: {
    local: false,
    cardanoNetwork: "preview",
    networkId: NetworkId.Testnet,
    aikenConfigSection: "govnet",
    production: false,
  },
  devnet: {
    local: false,
    cardanoNetwork: "preview",
    networkId: NetworkId.Testnet,
    aikenConfigSection: "devnet",
    production: false,
  },
  local: {
    local: true,
    cardanoNetwork: "local",
    networkId: NetworkId.Testnet,
    aikenConfigSection: "local",
    production: false,
  },
  emulator: {
    local: true,
    cardanoNetwork: null,
    networkId: NetworkId.Testnet,
    aikenConfigSection: "default",
    production: false,
  },
};

/** The chain providers the CLI talks to, as `--provider` takes them. */
export const PROVIDERS = ["blockfrost", "emulator", "kupmios"] as const;

export type ProviderType = (typeof PROVIDERS)[number];

/** Emulator without a chain, Kupmios on local, Blockfrost on a public network. */
export const defaultProviderFor = (
  cardanoNetwork: EnvironmentResolution["cardanoNetwork"],
): ProviderType =>
  cardanoNetwork === null
    ? "emulator"
    : cardanoNetwork === "local"
      ? "kupmios"
      : "blockfrost";

import { NetworkId } from "@blaze-cardano/core";

// Network type - kept simple as a union
export type Network = "local" | "preview" | "preprod" | "mainnet";

// Provider types specific to our setup
export type ProviderType = "blockfrost" | "maestro" | "emulator";

// Signer type for sr25519 keys used in multisig
export interface Signer {
  paymentHash: string;
  sr25519Key: string;
}

// Configuration loaded from aiken.toml for one-shot UTxOs
export interface NetworkConfig {
  technical_authority_one_shot_hash: string;
  technical_authority_one_shot_index: number;
  council_one_shot_hash: string;
  council_one_shot_index: number;
  reserve_one_shot_hash: string;
  reserve_one_shot_index: number;
  ics_one_shot_hash: string;
  ics_one_shot_index: number;
  federated_operators_one_shot_hash: string;
  federated_operators_one_shot_index: number;
  main_gov_one_shot_hash: string;
  main_gov_one_shot_index: number;
  staging_gov_one_shot_hash: string;
  staging_gov_one_shot_index: number;
  main_council_update_one_shot_hash: string;
  main_council_update_one_shot_index: number;
  main_tech_auth_update_one_shot_hash: string;
  main_tech_auth_update_one_shot_index: number;
  main_federated_ops_update_one_shot_hash: string;
  main_federated_ops_update_one_shot_index: number;
  terms_and_conditions_one_shot_hash: string;
  terms_and_conditions_one_shot_index: number;
  terms_and_conditions_threshold_one_shot_hash: string;
  terms_and_conditions_threshold_one_shot_index: number;
  cnight_policy: string;
}

// Utility functions
export function getNetworkId(network: Network): NetworkId {
  return network === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet;
}

export function getDefaultProvider(network: Network): ProviderType {
  return network === "local" ? "emulator" : "blockfrost";
}

export function getConfigSection(network: Network): string {
  return network === "local" ? "default" : network;
}

import { readFileSync } from "fs";
import { resolve } from "path";
import * as toml from "toml";
import type { Network, NetworkConfig } from "./types";
import { getConfigSection } from "./types";

export function loadAikenConfig(network: Network): NetworkConfig {
  const aikenTomlPath = resolve(process.cwd(), "aiken.toml");
  const aikenToml = readFileSync(aikenTomlPath, "utf-8");
  const parsedToml = toml.parse(aikenToml);

  const configSection = getConfigSection(network);
  const networkConfig = parsedToml.config[configSection];

  if (!networkConfig) {
    throw new Error(
      `Network config section '${configSection}' not found in aiken.toml`,
    );
  }

  return {
    technical_authority_one_shot_hash:
      networkConfig.technical_authority_one_shot_hash.bytes,
    technical_authority_one_shot_index:
      networkConfig.technical_authority_one_shot_index,
    council_one_shot_hash: networkConfig.council_one_shot_hash.bytes,
    council_one_shot_index: networkConfig.council_one_shot_index,
    reserve_one_shot_hash: networkConfig.reserve_one_shot_hash.bytes,
    reserve_one_shot_index: networkConfig.reserve_one_shot_index,
    ics_one_shot_hash: networkConfig.ics_one_shot_hash.bytes,
    ics_one_shot_index: networkConfig.ics_one_shot_index,
    federated_operators_one_shot_hash:
      networkConfig.federated_operators_one_shot_hash.bytes,
    federated_operators_one_shot_index:
      networkConfig.federated_operators_one_shot_index,
    main_gov_one_shot_hash: networkConfig.main_gov_one_shot_hash.bytes,
    main_gov_one_shot_index: networkConfig.main_gov_one_shot_index,
    staging_gov_one_shot_hash: networkConfig.staging_gov_one_shot_hash.bytes,
    staging_gov_one_shot_index: networkConfig.staging_gov_one_shot_index,
    main_council_update_one_shot_hash:
      networkConfig.main_council_update_one_shot_hash.bytes,
    main_council_update_one_shot_index:
      networkConfig.main_council_update_one_shot_index,
    main_tech_auth_update_one_shot_hash:
      networkConfig.main_tech_auth_update_one_shot_hash.bytes,
    main_tech_auth_update_one_shot_index:
      networkConfig.main_tech_auth_update_one_shot_index,
    main_federated_ops_update_one_shot_hash:
      networkConfig.main_federated_ops_update_one_shot_hash.bytes,
    main_federated_ops_update_one_shot_index:
      networkConfig.main_federated_ops_update_one_shot_index,
    terms_and_conditions_one_shot_hash:
      networkConfig.terms_and_conditions_one_shot_hash.bytes,
    terms_and_conditions_one_shot_index:
      networkConfig.terms_and_conditions_one_shot_index,
    terms_and_conditions_threshold_one_shot_hash:
      networkConfig.terms_and_conditions_threshold_one_shot_hash.bytes,
    terms_and_conditions_threshold_one_shot_index:
      networkConfig.terms_and_conditions_threshold_one_shot_index,
    cnight_policy: networkConfig.cnight_policy.bytes,
  };
}

export function getEnvVar(name: string, required: boolean = true): string {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value || "";
}

export function getDeployerAddress(): string {
  const deployerAddr = process.env.DEPLOYER_ADDRESS;
  if (deployerAddr) {
    return deployerAddr;
  }
  // Default test address
  return "addr_test1qruhen60uwzpwnnr7gjs50z2v8u9zyfw6zunet4k42zrpr54mrlv55f93rs6j48wt29w90hlxt4rvpvshe55k5r9mpvqjv2wt4";
}

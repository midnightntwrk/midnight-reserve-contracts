import { readFileSync } from "fs";
import { resolve } from "path";
import * as toml from "toml";
import type { NetworkConfig } from "./types";
import { getConfigSection } from "./types";

export function loadAikenConfig(environment: string): NetworkConfig {
  const aikenTomlPath = resolve(process.cwd(), "aiken.toml");
  const aikenToml = readFileSync(aikenTomlPath, "utf-8");
  const parsedToml = toml.parse(aikenToml);

  const configSection = getConfigSection(environment);
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
    collateral_utxo_hash: networkConfig.collateral_utxo_hash?.bytes ?? "",
    collateral_utxo_index: networkConfig.collateral_utxo_index ?? 15,
    cnight_policy: networkConfig.cnight_policy.bytes,
    cnight_name: networkConfig.cnight_name,
    reserve_staging_one_shot_hash:
      networkConfig.reserve_staging_one_shot_hash.bytes,
    reserve_staging_one_shot_index:
      networkConfig.reserve_staging_one_shot_index,
    council_staging_one_shot_hash:
      networkConfig.council_staging_one_shot_hash.bytes,
    council_staging_one_shot_index:
      networkConfig.council_staging_one_shot_index,
    ics_staging_one_shot_hash: networkConfig.ics_staging_one_shot_hash.bytes,
    ics_staging_one_shot_index: networkConfig.ics_staging_one_shot_index,
    technical_authority_staging_one_shot_hash:
      networkConfig.technical_authority_staging_one_shot_hash.bytes,
    technical_authority_staging_one_shot_index:
      networkConfig.technical_authority_staging_one_shot_index,
    federated_operators_staging_one_shot_hash:
      networkConfig.federated_operators_staging_one_shot_hash.bytes,
    federated_operators_staging_one_shot_index:
      networkConfig.federated_operators_staging_one_shot_index,
    terms_and_conditions_staging_one_shot_hash:
      networkConfig.terms_and_conditions_staging_one_shot_hash.bytes,
    terms_and_conditions_staging_one_shot_index:
      networkConfig.terms_and_conditions_staging_one_shot_index,
    reserve_logic_v2_one_shot_hash:
      networkConfig.reserve_logic_v2_one_shot_hash.bytes,
    reserve_logic_v2_one_shot_index:
      networkConfig.reserve_logic_v2_one_shot_index,
    ics_logic_v2_one_shot_hash: networkConfig.ics_logic_v2_one_shot_hash.bytes,
    ics_logic_v2_one_shot_index: networkConfig.ics_logic_v2_one_shot_index,
    council_logic_v2_one_shot_hash:
      networkConfig.council_logic_v2_one_shot_hash.bytes,
    council_logic_v2_one_shot_index:
      networkConfig.council_logic_v2_one_shot_index,
    technical_authority_logic_v2_one_shot_hash:
      networkConfig.technical_authority_logic_v2_one_shot_hash.bytes,
    technical_authority_logic_v2_one_shot_index:
      networkConfig.technical_authority_logic_v2_one_shot_index,
    federated_operators_logic_v2_one_shot_hash:
      networkConfig.federated_operators_logic_v2_one_shot_hash.bytes,
    federated_operators_logic_v2_one_shot_index:
      networkConfig.federated_operators_logic_v2_one_shot_index,
    terms_and_conditions_logic_v2_one_shot_hash:
      networkConfig.terms_and_conditions_logic_v2_one_shot_hash.bytes,
    terms_and_conditions_logic_v2_one_shot_index:
      networkConfig.terms_and_conditions_logic_v2_one_shot_index,
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

export function getDeployUtxoAmount(): bigint {
  const value = process.env.DEPLOY_UTXO_AMOUNT;
  return value ? BigInt(value) : 20_000_000n;
}

export interface Threshold {
  numerator: bigint;
  denominator: bigint;
}

function parseThresholdFromEnv(
  value: string | undefined,
  defaultNum: bigint,
  defaultDenom: bigint,
): Threshold {
  if (!value) {
    return { numerator: defaultNum, denominator: defaultDenom };
  }
  const parts = value.split("/");
  if (parts.length !== 2) {
    throw new Error(
      `Invalid threshold format '${value}'. Expected format: 'numerator/denominator' (e.g., '2/3')`,
    );
  }
  return {
    numerator: BigInt(parts[0]),
    denominator: BigInt(parts[1]),
  };
}

export function getTechAuthThreshold(): Threshold {
  return parseThresholdFromEnv(process.env.TECH_AUTH_THRESHOLD, 2n, 3n);
}

export function getCouncilThreshold(): Threshold {
  return parseThresholdFromEnv(process.env.COUNCIL_THRESHOLD, 2n, 3n);
}

export function getCouncilStagingThreshold(): Threshold {
  return parseThresholdFromEnv(process.env.COUNCIL_STAGING_THRESHOLD, 0n, 1n);
}

export function getTechAuthStagingThreshold(): Threshold {
  return parseThresholdFromEnv(process.env.TECH_AUTH_STAGING_THRESHOLD, 1n, 2n);
}

export function getTermsAndConditionsInitialHash(): string {
  const value = process.env.TERMS_AND_CONDITIONS_INITIAL_HASH;
  const DEFAULT_HASH =
    "0000000000000000000000000000000000000000000000000000000000000000";
  return value || DEFAULT_HASH;
}

export function getTermsAndConditionsInitialLink(): string {
  const value = process.env.TERMS_AND_CONDITIONS_INITIAL_LINK || "";
  // Accept plain-text URL from env, convert to hex for on-chain ByteArray
  return value ? Buffer.from(value).toString("hex") : "";
}

export function getSimpleTxCount(): number {
  const value = process.env.SIMPLE_TX_COUNT;
  return value ? parseInt(value, 10) : 15;
}

export function getSimpleTxAmount(): bigint {
  const value = process.env.SIMPLE_TX_AMOUNT;
  return value ? BigInt(value) : 20_000_000n;
}

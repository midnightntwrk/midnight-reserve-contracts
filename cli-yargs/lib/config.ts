import { readFileSync } from "fs";
import { resolve } from "path";
import * as toml from "toml";
import type { NetworkConfig } from "./types";
import { getConfigSection } from "./types";

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireObjectField(
  source: Record<string, unknown>,
  key: string,
  parentPath: string,
): Record<string, unknown> {
  const value = source[key];
  const path = `${parentPath}.${key}`;
  if (!isObjectLike(value)) {
    throw new Error(`Invalid aiken.toml field '${path}': expected table/object`);
  }
  return value;
}

function requireBytesField(
  source: Record<string, unknown>,
  key: string,
  parentPath: string,
): string {
  const table = requireObjectField(source, key, parentPath);
  const bytes = table.bytes;
  const path = `${parentPath}.${key}.bytes`;
  if (typeof bytes !== "string") {
    throw new Error(`Invalid aiken.toml field '${path}': expected string`);
  }
  return bytes;
}

function optionalBytesField(
  source: Record<string, unknown>,
  key: string,
  parentPath: string,
  fallback: string,
): string {
  const value = source[key];
  if (value === undefined) {
    return fallback;
  }
  if (!isObjectLike(value)) {
    throw new Error(
      `Invalid aiken.toml field '${parentPath}.${key}': expected table/object`,
    );
  }
  const bytes = value.bytes;
  const path = `${parentPath}.${key}.bytes`;
  if (typeof bytes !== "string") {
    throw new Error(`Invalid aiken.toml field '${path}': expected string`);
  }
  return bytes;
}

function requireIntegerField(
  source: Record<string, unknown>,
  key: string,
  parentPath: string,
): number {
  const value = source[key];
  const path = `${parentPath}.${key}`;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Invalid aiken.toml field '${path}': expected integer`);
  }
  return value;
}

function optionalIntegerField(
  source: Record<string, unknown>,
  key: string,
  parentPath: string,
  fallback: number,
): number {
  const value = source[key];
  if (value === undefined) {
    return fallback;
  }
  const path = `${parentPath}.${key}`;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Invalid aiken.toml field '${path}': expected integer`);
  }
  return value;
}

function requireStringField(
  source: Record<string, unknown>,
  key: string,
  parentPath: string,
): string {
  const value = source[key];
  const path = `${parentPath}.${key}`;
  if (typeof value !== "string") {
    throw new Error(`Invalid aiken.toml field '${path}': expected string`);
  }
  return value;
}

export function loadAikenConfig(environment: string): NetworkConfig {
  const aikenTomlPath = resolve(process.cwd(), "aiken.toml");
  const aikenToml = readFileSync(aikenTomlPath, "utf-8");
  const parsedToml = toml.parse(aikenToml);

  if (!isObjectLike(parsedToml)) {
    throw new Error("Invalid aiken.toml: expected top-level TOML table/object");
  }

  const configSection = getConfigSection(environment);
  const config = parsedToml.config;
  if (!isObjectLike(config)) {
    throw new Error("Invalid aiken.toml: expected 'config' to be a table/object");
  }
  const sectionPath = `config.${configSection}`;
  const networkConfig = config[configSection];

  if (!isObjectLike(networkConfig)) {
    throw new Error(
      `Invalid aiken.toml: expected '${sectionPath}' to be a table/object`,
    );
  }

  const getHash = (field: string): string =>
    requireBytesField(networkConfig, field, sectionPath);
  const getIndex = (field: string): number =>
    requireIntegerField(networkConfig, field, sectionPath);

  return {
    technical_authority_one_shot_hash: getHash("technical_authority_one_shot_hash"),
    technical_authority_one_shot_index: getIndex("technical_authority_one_shot_index"),
    council_one_shot_hash: getHash("council_one_shot_hash"),
    council_one_shot_index: getIndex("council_one_shot_index"),
    reserve_one_shot_hash: getHash("reserve_one_shot_hash"),
    reserve_one_shot_index: getIndex("reserve_one_shot_index"),
    ics_one_shot_hash: getHash("ics_one_shot_hash"),
    ics_one_shot_index: getIndex("ics_one_shot_index"),
    federated_operators_one_shot_hash: getHash("federated_operators_one_shot_hash"),
    federated_operators_one_shot_index: getIndex("federated_operators_one_shot_index"),
    main_gov_one_shot_hash: getHash("main_gov_one_shot_hash"),
    main_gov_one_shot_index: getIndex("main_gov_one_shot_index"),
    staging_gov_one_shot_hash: getHash("staging_gov_one_shot_hash"),
    staging_gov_one_shot_index: getIndex("staging_gov_one_shot_index"),
    main_council_update_one_shot_hash: getHash("main_council_update_one_shot_hash"),
    main_council_update_one_shot_index: getIndex("main_council_update_one_shot_index"),
    main_tech_auth_update_one_shot_hash: getHash("main_tech_auth_update_one_shot_hash"),
    main_tech_auth_update_one_shot_index: getIndex("main_tech_auth_update_one_shot_index"),
    main_federated_ops_update_one_shot_hash: getHash("main_federated_ops_update_one_shot_hash"),
    main_federated_ops_update_one_shot_index: getIndex("main_federated_ops_update_one_shot_index"),
    terms_and_conditions_one_shot_hash: getHash("terms_and_conditions_one_shot_hash"),
    terms_and_conditions_one_shot_index: getIndex("terms_and_conditions_one_shot_index"),
    terms_and_conditions_threshold_one_shot_hash: getHash(
      "terms_and_conditions_threshold_one_shot_hash",
    ),
    terms_and_conditions_threshold_one_shot_index: getIndex(
      "terms_and_conditions_threshold_one_shot_index",
    ),
    collateral_utxo_hash: optionalBytesField(
      networkConfig,
      "collateral_utxo_hash",
      sectionPath,
      "",
    ),
    collateral_utxo_index: optionalIntegerField(
      networkConfig,
      "collateral_utxo_index",
      sectionPath,
      15,
    ),
    cnight_policy: getHash("cnight_policy"),
    cnight_name: requireStringField(networkConfig, "cnight_name", sectionPath),
    reserve_staging_one_shot_hash: getHash("reserve_staging_one_shot_hash"),
    reserve_staging_one_shot_index: getIndex("reserve_staging_one_shot_index"),
    council_staging_one_shot_hash: getHash("council_staging_one_shot_hash"),
    council_staging_one_shot_index: getIndex("council_staging_one_shot_index"),
    ics_staging_one_shot_hash: getHash("ics_staging_one_shot_hash"),
    ics_staging_one_shot_index: getIndex("ics_staging_one_shot_index"),
    technical_authority_staging_one_shot_hash: getHash(
      "technical_authority_staging_one_shot_hash",
    ),
    technical_authority_staging_one_shot_index: getIndex(
      "technical_authority_staging_one_shot_index",
    ),
    federated_operators_staging_one_shot_hash: getHash(
      "federated_operators_staging_one_shot_hash",
    ),
    federated_operators_staging_one_shot_index: getIndex(
      "federated_operators_staging_one_shot_index",
    ),
    terms_and_conditions_staging_one_shot_hash: getHash(
      "terms_and_conditions_staging_one_shot_hash",
    ),
    terms_and_conditions_staging_one_shot_index: getIndex(
      "terms_and_conditions_staging_one_shot_index",
    ),
    reserve_logic_v2_one_shot_hash: getHash("reserve_logic_v2_one_shot_hash"),
    reserve_logic_v2_one_shot_index: getIndex("reserve_logic_v2_one_shot_index"),
    ics_logic_v2_one_shot_hash: getHash("ics_logic_v2_one_shot_hash"),
    ics_logic_v2_one_shot_index: getIndex("ics_logic_v2_one_shot_index"),
    council_logic_v2_one_shot_hash: getHash("council_logic_v2_one_shot_hash"),
    council_logic_v2_one_shot_index: getIndex("council_logic_v2_one_shot_index"),
    technical_authority_logic_v2_one_shot_hash: getHash(
      "technical_authority_logic_v2_one_shot_hash",
    ),
    technical_authority_logic_v2_one_shot_index: getIndex(
      "technical_authority_logic_v2_one_shot_index",
    ),
    federated_operators_logic_v2_one_shot_hash: getHash(
      "federated_operators_logic_v2_one_shot_hash",
    ),
    federated_operators_logic_v2_one_shot_index: getIndex(
      "federated_operators_logic_v2_one_shot_index",
    ),
    terms_and_conditions_logic_v2_one_shot_hash: getHash(
      "terms_and_conditions_logic_v2_one_shot_hash",
    ),
    terms_and_conditions_logic_v2_one_shot_index: getIndex(
      "terms_and_conditions_logic_v2_one_shot_index",
    ),
    cnight_minting_one_shot_hash: getHash("cnight_minting_one_shot_hash"),
    cnight_minting_one_shot_index: getIndex("cnight_minting_one_shot_index"),
  };
}

export function getEnvVar(name: string, required: boolean = true): string {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value || "";
}

export function getDeployerAddress(environment?: string): string {
  const deployerAddr = process.env.DEPLOYER_ADDRESS;
  if (deployerAddr) {
    return deployerAddr;
  }
  const isLocal =
    !environment || environment === "local" || environment === "emulator";
  if (!isLocal) {
    throw new Error(
      `DEPLOYER_ADDRESS environment variable is required for non-local environment '${environment}'`,
    );
  }
  // Default test address for local/emulator only
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
  const parts = value.split("/").map((part) => part.trim());
  if (parts.length !== 2) {
    throw new Error(
      `Invalid threshold format '${value}'. Expected format: 'numerator/denominator' (e.g., '2/3')`,
    );
  }

  let numerator: bigint;
  let denominator: bigint;
  try {
    numerator = BigInt(parts[0]);
    denominator = BigInt(parts[1]);
  } catch {
    throw new Error(
      `Invalid threshold format '${value}'. Expected format: 'numerator/denominator' (e.g., '2/3')`,
    );
  }

  if (denominator <= 0n) {
    throw new Error(
      `Invalid threshold value '${value}': denominator must be greater than zero`,
    );
  }
  if (numerator < 0n) {
    throw new Error(
      `Invalid threshold value '${value}': numerator must be non-negative`,
    );
  }
  if (numerator > denominator) {
    throw new Error(
      `Invalid threshold value '${value}': numerator must be less than or equal to denominator`,
    );
  }

  return { numerator, denominator };
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
  if (!value) {
    return 16;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(
      `Invalid SIMPLE_TX_COUNT '${value}': expected a positive base-10 integer`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid SIMPLE_TX_COUNT '${value}': expected a positive base-10 integer`,
    );
  }
  return parsed;
}

export function getSimpleTxAmount(): bigint {
  const value = process.env.SIMPLE_TX_AMOUNT;
  if (!value) {
    return 20_000_000n;
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(
      `Invalid SIMPLE_TX_AMOUNT '${value}': expected a positive bigint`,
    );
  }
  if (parsed <= 0n) {
    throw new Error(
      `Invalid SIMPLE_TX_AMOUNT '${value}': expected a positive bigint`,
    );
  }
  return parsed;
}

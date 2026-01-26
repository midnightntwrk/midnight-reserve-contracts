import {
  addressFromValidator,
  addressFromCredential,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  Script,
} from "@blaze-cardano/core";
import { getNetworkId, getConfigSection } from "./types";
import { resolve } from "path";
import { existsSync } from "fs";

/**
 * Contract instance type - all contract classes have a Script property
 */
interface ContractClass {
  Script: Script;
}

export interface ContractInstances {
  // Tech Auth
  techAuthTwoStage: ContractClass;
  techAuthForever: ContractClass;
  techAuthLogic: ContractClass;

  // Council
  councilTwoStage: ContractClass;
  councilForever: ContractClass;
  councilLogic: ContractClass;

  // Reserve
  reserveForever: ContractClass;
  reserveTwoStage: ContractClass;
  reserveLogic: ContractClass;

  // Gov Auth
  govAuth: ContractClass;
  stagingGovAuth: ContractClass;

  // ICS
  icsForever: ContractClass;
  icsTwoStage: ContractClass;
  icsLogic: ContractClass;

  // Federated Ops
  federatedOpsForever: ContractClass;
  federatedOpsTwoStage: ContractClass;
  federatedOpsLogic: ContractClass;

  // Thresholds
  mainGovThreshold: ContractClass;
  stagingGovThreshold: ContractClass;
  mainCouncilUpdateThreshold: ContractClass;
  mainTechAuthUpdateThreshold: ContractClass;
  mainFederatedOpsUpdateThreshold: ContractClass;

  // TCnight Mint Infinite (testnet only)
  tcnightMintInfinite: ContractClass;

  // Terms and Conditions
  termsAndConditionsForever: ContractClass;
  termsAndConditionsTwoStage: ContractClass;
  termsAndConditionsLogic: ContractClass;
  termsAndConditionsThreshold: ContractClass;
}

// Per-environment cache for contract instances
const instanceCache = new Map<string, ContractInstances>();

// Track the currently active environment for backward compatibility
let activeEnvironment: string | null = null;

/**
 * Resolves the blueprint file path for a given environment.
 * Falls back to default if the environment-specific file doesn't exist.
 */
function getBlueprintPath(env: string): string {
  const projectRoot = resolve(import.meta.dir, "../..");
  const envPath = resolve(projectRoot, `contract_blueprint_${env}.ts`);
  const defaultPath = resolve(projectRoot, "contract_blueprint.ts");

  if (existsSync(envPath)) {
    return envPath;
  }

  if (existsSync(defaultPath)) {
    console.warn(
      `Blueprint file for environment '${env}' not found at ${envPath}. ` +
        `Falling back to default contract_blueprint.ts`,
    );
    return defaultPath;
  }

  throw new Error(
    `No blueprint file found. Expected: ${envPath} or ${defaultPath}. ` +
      `Run 'just build ${env}' to generate the blueprint.`,
  );
}

/**
 * Loads the contract module for a given environment.
 * Uses Bun's require for synchronous loading.
 */
function loadContractModule(env: string): Record<string, unknown> {
  const blueprintPath = getBlueprintPath(env);
  // Use require for synchronous loading (Bun supports this)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(blueprintPath);
}

/**
 * Creates contract instances from a loaded module.
 */
function createInstances(
  Contracts: Record<string, unknown>,
): ContractInstances {
  // Helper to instantiate a contract class
  const create = (className: string): ContractClass => {
    const ContractClass = Contracts[className] as new () => ContractClass;
    if (!ContractClass) {
      throw new Error(`Contract class '${className}' not found in blueprint`);
    }
    return new ContractClass();
  };

  return {
    // Tech Auth
    techAuthTwoStage: create("PermissionedTechAuthTwoStageUpgradeElse"),
    techAuthForever: create("PermissionedTechAuthForeverElse"),
    techAuthLogic: create("PermissionedTechAuthLogicElse"),

    // Council
    councilTwoStage: create("PermissionedCouncilTwoStageUpgradeElse"),
    councilForever: create("PermissionedCouncilForeverElse"),
    councilLogic: create("PermissionedCouncilLogicElse"),

    // Reserve
    reserveForever: create("ReserveReserveForeverElse"),
    reserveTwoStage: create("ReserveReserveTwoStageUpgradeElse"),
    reserveLogic: create("ReserveReserveLogicElse"),

    // Gov Auth
    govAuth: create("GovAuthMainGovAuthElse"),
    stagingGovAuth: create("GovAuthStagingGovAuthElse"),

    // ICS
    icsForever: create("IlliquidCirculationSupplyIcsForeverElse"),
    icsTwoStage: create("IlliquidCirculationSupplyIcsTwoStageUpgradeElse"),
    icsLogic: create("IlliquidCirculationSupplyIcsLogicElse"),

    // Federated Ops
    federatedOpsForever: create("PermissionedFederatedOpsForeverElse"),
    federatedOpsTwoStage: create("PermissionedFederatedOpsTwoStageUpgradeElse"),
    federatedOpsLogic: create("PermissionedFederatedOpsLogicElse"),

    // Thresholds
    mainGovThreshold: create("ThresholdsMainGovThresholdElse"),
    stagingGovThreshold: create("ThresholdsStagingGovThresholdElse"),
    mainCouncilUpdateThreshold: create(
      "ThresholdsMainCouncilUpdateThresholdElse",
    ),
    mainTechAuthUpdateThreshold: create(
      "ThresholdsMainTechAuthUpdateThresholdElse",
    ),
    mainFederatedOpsUpdateThreshold: create(
      "ThresholdsMainFederatedOpsUpdateThresholdElse",
    ),

    // TCnight Mint Infinite (testnet only)
    tcnightMintInfinite: create("TestCnightNoAuditTcnightMintInfiniteElse"),

    // Terms and Conditions
    termsAndConditionsForever: create(
      "TermsAndConditionsTermsAndConditionsForeverElse",
    ),
    termsAndConditionsTwoStage: create(
      "TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse",
    ),
    termsAndConditionsLogic: create(
      "TermsAndConditionsTermsAndConditionsLogicElse",
    ),
    termsAndConditionsThreshold: create(
      "ThresholdsTermsAndConditionsThresholdElse",
    ),
  };
}

/**
 * Gets contract instances for a given environment.
 *
 * @param env - The deployment environment (e.g., "preview", "preprod", "mainnet", or custom like "qanet")
 *              Maps to aiken.toml config section via getConfigSection()
 * @returns ContractInstances with environment-specific compiled scripts
 *
 * @example
 * const contracts = getContractInstances("preview");
 * const contracts = getContractInstances("preprod");
 */
export function getContractInstances(env?: string): ContractInstances {
  // If no env provided, use active environment or fall back to loading default blueprint
  const targetEnv = env
    ? getConfigSection(env)
    : (activeEnvironment ?? "default");

  // Check cache
  const cached = instanceCache.get(targetEnv);
  if (cached) {
    return cached;
  }

  // Load and cache
  const Contracts = loadContractModule(targetEnv);
  const instances = createInstances(Contracts);
  instanceCache.set(targetEnv, instances);

  // Update active environment if this is the first load or if explicitly set
  if (env) {
    activeEnvironment = targetEnv;
  }

  return instances;
}

/**
 * Initializes contracts for a specific environment.
 * Call this early in CLI commands to ensure the correct contracts are loaded.
 *
 * @param env - The deployment environment
 */
export function initContractsForEnvironment(env: string): void {
  const configSection = getConfigSection(env);
  activeEnvironment = configSection;
  // Pre-load the contracts
  getContractInstances(env);
}

export function getContractAddress(
  network: string,
  script: Script,
): ReturnType<typeof addressFromValidator> {
  const networkId = getNetworkId(network);
  return addressFromValidator(networkId, script);
}

export function getCredentialAddress(
  network: string,
  scriptHash: string,
): ReturnType<typeof addressFromCredential> {
  const networkId = getNetworkId(network);
  return addressFromCredential(
    networkId,
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(scriptHash),
    }),
  );
}

export interface TwoStageContracts {
  twoStage: { Script: Script };
  forever: { Script: Script };
  logic: { Script: Script };
}

/**
 * Gets the two-stage contracts for a validator.
 *
 * @param validatorName - The validator name (e.g., "tech-auth", "council")
 * @param env - Optional environment. If not provided, uses the active environment.
 */
export function getTwoStageContracts(
  validatorName: string,
  env?: string,
): TwoStageContracts {
  const contracts = getContractInstances(env);

  switch (validatorName) {
    case "tech-auth":
      return {
        twoStage: contracts.techAuthTwoStage,
        forever: contracts.techAuthForever,
        logic: contracts.techAuthLogic,
      };
    case "council":
      return {
        twoStage: contracts.councilTwoStage,
        forever: contracts.councilForever,
        logic: contracts.councilLogic,
      };
    case "reserve":
      return {
        twoStage: contracts.reserveTwoStage,
        forever: contracts.reserveForever,
        logic: contracts.reserveLogic,
      };
    case "ics":
      return {
        twoStage: contracts.icsTwoStage,
        forever: contracts.icsForever,
        logic: contracts.icsLogic,
      };
    case "federated-ops":
      return {
        twoStage: contracts.federatedOpsTwoStage,
        forever: contracts.federatedOpsForever,
        logic: contracts.federatedOpsLogic,
      };
    case "terms-and-conditions":
      return {
        twoStage: contracts.termsAndConditionsTwoStage,
        forever: contracts.termsAndConditionsForever,
        logic: contracts.termsAndConditionsLogic,
      };
    default:
      throw new Error(`Unknown two-stage validator: ${validatorName}`);
  }
}

/**
 * Finds a script by its hash.
 *
 * @param hash - The script hash to find
 * @param env - Optional environment. If not provided, uses the active environment.
 */
export function findScriptByHash(hash: string, env?: string): Script | null {
  const contracts = getContractInstances(env);
  const scriptMap: Record<string, Script> = {
    [contracts.councilLogic.Script.hash()]: contracts.councilLogic.Script,
    [contracts.techAuthLogic.Script.hash()]: contracts.techAuthLogic.Script,
    [contracts.reserveLogic.Script.hash()]: contracts.reserveLogic.Script,
    [contracts.icsLogic.Script.hash()]: contracts.icsLogic.Script,
    [contracts.federatedOpsLogic.Script.hash()]:
      contracts.federatedOpsLogic.Script,
    [contracts.termsAndConditionsLogic.Script.hash()]:
      contracts.termsAndConditionsLogic.Script,
    [contracts.govAuth.Script.hash()]: contracts.govAuth.Script,
    [contracts.stagingGovAuth.Script.hash()]: contracts.stagingGovAuth.Script,
  };
  return scriptMap[hash] ?? null;
}

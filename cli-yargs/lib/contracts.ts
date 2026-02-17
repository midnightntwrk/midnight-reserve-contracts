import {
  addressFromValidator,
  addressFromCredential,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  Script,
} from "@blaze-cardano/core";
import { getNetworkId, getConfigSection } from "./types";
import { findContractByHash } from "./blueprint-diff";
import { getCurrentVersion, getDeployedScriptsPath } from "./versions";
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

  // Staging Forever (for staging track deployment)
  councilStagingForever?: ContractClass;
  techAuthStagingForever?: ContractClass;
  federatedOpsStagingForever?: ContractClass;
  reserveStagingForever?: ContractClass;
  icsStagingForever?: ContractClass;
  termsAndConditionsStagingForever?: ContractClass;

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

  // TCnight Mint Infinite (testnet only, not in mainnet blueprint)
  tcnightMintInfinite?: ContractClass;

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
 * Resolves the blueprint file path for a given environment using versions.json.
 *
 * Non-build mode: strict versions.json resolution only.
 * Build mode: contract_blueprint_{env}.ts or contract_blueprint.ts at project root.
 */
function getBlueprintPath(env: string, useBuild: boolean = false): string {
  const projectRoot = resolve(import.meta.dir, "../..");

  if (!useBuild) {
    // Strict versions.json resolution — no fallback
    const currentVersion = getCurrentVersion(env);
    if (!currentVersion) {
      throw new Error(
        `No current version set for environment '${env}'. ` +
          `Expected versions.json in deployed-scripts/${env}/ with a 'current' field. ` +
          `Run deployment first or use --use-build to load from build outputs.`,
      );
    }

    const versionedPath = resolve(
      getDeployedScriptsPath(env),
      "versions",
      currentVersion,
      "contract_blueprint.ts",
    );
    if (!existsSync(versionedPath)) {
      throw new Error(
        `Blueprint not found at deployed-scripts/${env}/versions/${currentVersion}/contract_blueprint.ts. ` +
          `The version '${currentVersion}' may be corrupt. Check versions.json.`,
      );
    }
    return versionedPath;
  }

  // Build mode: explicit environment-specific or default build output
  const envPath = resolve(projectRoot, `contract_blueprint_${env}.ts`);
  if (existsSync(envPath)) {
    return envPath;
  }

  const defaultPath = resolve(projectRoot, "contract_blueprint.ts");
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  throw new Error(
    `No build output found for environment '${env}'. ` +
      `Expected contract_blueprint_${env}.ts or contract_blueprint.ts at project root. ` +
      `Run 'just build ${env}' to generate the blueprint.`,
  );
}

/**
 * Loads the contract module for a given environment.
 */
export function loadContractModule(
  env: string,
  useBuild: boolean = false,
): Record<string, unknown> {
  const blueprintPath = getBlueprintPath(env, useBuild);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(blueprintPath);
}

/**
 * Creates contract instances from a loaded module.
 */
function createInstances(
  Contracts: Record<string, unknown>,
): ContractInstances {
  const create = (className: string): ContractClass => {
    const ContractClass = Contracts[className] as new () => ContractClass;
    if (!ContractClass) {
      throw new Error(`Contract class '${className}' not found in blueprint`);
    }
    return new ContractClass();
  };

  const tryCreate = (className: string): ContractClass | undefined => {
    const ContractClass = Contracts[className] as new () => ContractClass;
    if (!ContractClass) return undefined;
    try {
      return new ContractClass();
    } catch {
      return undefined;
    }
  };

  return {
    techAuthTwoStage: create("PermissionedTechAuthTwoStageUpgradeElse"),
    techAuthForever: create("PermissionedTechAuthForeverElse"),
    techAuthLogic: create("PermissionedTechAuthLogicElse"),

    councilTwoStage: create("PermissionedCouncilTwoStageUpgradeElse"),
    councilForever: create("PermissionedCouncilForeverElse"),
    councilLogic: create("PermissionedCouncilLogicElse"),

    reserveForever: create("ReserveReserveForeverElse"),
    reserveTwoStage: create("ReserveReserveTwoStageUpgradeElse"),
    reserveLogic: create("ReserveReserveLogicElse"),

    govAuth: create("GovAuthMainGovAuthElse"),
    stagingGovAuth: create("GovAuthStagingGovAuthElse"),

    councilStagingForever: tryCreate(
      "StagingPermissionedCouncilStagingForeverElse",
    ),
    techAuthStagingForever: tryCreate(
      "StagingPermissionedTechAuthStagingForeverElse",
    ),
    federatedOpsStagingForever: tryCreate(
      "StagingPermissionedFederatedOpsStagingForeverElse",
    ),
    reserveStagingForever: tryCreate(
      "StagingReserveIcsReserveStagingForeverElse",
    ),
    icsStagingForever: tryCreate("StagingReserveIcsIcsStagingForeverElse"),
    termsAndConditionsStagingForever: tryCreate(
      "StagingTandcTermsAndConditionsStagingForeverElse",
    ),

    icsForever: create("IlliquidCirculationSupplyIcsForeverElse"),
    icsTwoStage: create("IlliquidCirculationSupplyIcsTwoStageUpgradeElse"),
    icsLogic: create("IlliquidCirculationSupplyIcsLogicElse"),

    federatedOpsForever: create("PermissionedFederatedOpsForeverElse"),
    federatedOpsTwoStage: create("PermissionedFederatedOpsTwoStageUpgradeElse"),
    federatedOpsLogic: create("PermissionedFederatedOpsLogicElse"),

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

    tcnightMintInfinite: tryCreate("TestCnightNoAuditTcnightMintInfiniteElse"),

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
 */
export function getContractInstances(
  env?: string,
  useBuild: boolean = false,
): ContractInstances {
  const targetEnv = env
    ? getConfigSection(env)
    : (activeEnvironment ?? "default");

  const cacheKey = useBuild ? `${targetEnv}:build` : targetEnv;

  const cached = instanceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const Contracts = loadContractModule(targetEnv, useBuild);
  const instances = createInstances(Contracts);
  instanceCache.set(cacheKey, instances);

  if (env) {
    activeEnvironment = targetEnv;
  }

  return instances;
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
 */
export function getTwoStageContracts(
  validatorName: string,
  env?: string,
  useBuild?: boolean,
): TwoStageContracts {
  const contracts = getContractInstances(env, useBuild);

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
 */
export function findScriptByHash(
  hash: string,
  env?: string,
  useBuild?: boolean,
): Script | null {
  const targetEnv = env
    ? getConfigSection(env)
    : (activeEnvironment ?? "default");
  const Contracts = loadContractModule(targetEnv, useBuild);
  const result = findContractByHash(Contracts, hash);
  return result?.script ?? null;
}

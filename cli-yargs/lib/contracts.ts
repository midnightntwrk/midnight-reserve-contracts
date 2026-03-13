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

  // cNIGHT Minting (optional — not present in older deployed blueprints)
  cnightMintTwoStage?: ContractClass;
  cnightMintForever?: ContractClass;
  cnightMintLogic?: ContractClass;

  // Registered Candidate
  registeredCandidate?: ContractClass;

  // cNIGHT Generates Dust
  cnightGeneratesDust?: ContractClass;
}

// Per-environment cache for contract instances
const instanceCache = new Map<string, ContractInstances>();

/**
 * Loads the contract module for a given environment.
 *
 * Uses static require paths (one per known env) so all possible imports are
 * statically analyzable. To add a new environment: add a case in both branches.
 *
 * env must be an aikenConfigSection value (already resolved via getConfigSection).
 */
export function loadContractModule(
  env: string,
  useBuild: boolean = false,
): Record<string, unknown> {
  if (useBuild) {
    switch (env) {
      case "default":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_default");
      case "mainnet":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_mainnet");
      case "preprod":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_preprod");
      case "preview":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_preview");
      case "qanet":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_qanet");
      case "govnet":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_govnet");
      case "node-dev-01":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_node-dev-01");
      case "node-dev-2":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_node-dev-2");
      case "node-dev-3":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_node-dev-3");
      case "local":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../contract_blueprint_local");
      default:
        throw new Error(
          `Unknown environment '${env}' for build mode. ` +
            `Run 'just build ${env}' and add a case for it in loadContractModule (cli-yargs/lib/contracts.ts).`,
        );
    }
  } else {
    switch (env) {
      case "default":
        throw new Error(
          `The local/emulator environment has no deployed scripts. ` +
            `Pass --use-build to load from build output instead.`,
        );
      case "local":
        throw new Error(
          `The local environment has no deployed scripts. ` +
            `Pass --use-build to load from build output instead.`,
        );
      case "mainnet":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../deployed-scripts/mainnet/contract_blueprint");
      case "preprod":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../deployed-scripts/preprod/contract_blueprint");
      case "preview":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../deployed-scripts/preview/contract_blueprint");
      case "qanet":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../deployed-scripts/qanet/contract_blueprint");
      case "govnet":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../deployed-scripts/govnet/contract_blueprint");
      case "node-dev-01":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../deployed-scripts/node-dev-01/contract_blueprint");
      case "node-dev-2":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../deployed-scripts/node-dev-2/contract_blueprint");
      case "node-dev-3":
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../../deployed-scripts/node-dev-3/contract_blueprint");
      default:
        throw new Error(
          `Unknown environment '${env}' for deployed mode. ` +
            `Deploy first and add a case for it in loadContractModule (cli-yargs/lib/contracts.ts).`,
        );
    }
  }
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

    cnightMintTwoStage: tryCreate("CnightMintingCnightMintTwoStageUpgradeElse"),
    cnightMintForever: tryCreate("CnightMintingCnightMintForeverElse"),
    cnightMintLogic: tryCreate("CnightMintingCnightMintLogicElse"),

    registeredCandidate: tryCreate(
      "RegisteredCandidateRegisteredCandidateElse",
    ),
    cnightGeneratesDust: tryCreate(
      "CnightGeneratesDustCnightGeneratesDustElse",
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
  const targetEnv = env ? getConfigSection(env) : "default";

  const cacheKey = useBuild ? `${targetEnv}:build` : targetEnv;

  const cached = instanceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const Contracts = loadContractModule(targetEnv, useBuild);
  const instances = createInstances(Contracts);
  instanceCache.set(cacheKey, instances);

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
    case "cnight-minting":
      if (
        !contracts.cnightMintTwoStage ||
        !contracts.cnightMintForever ||
        !contracts.cnightMintLogic
      ) {
        throw new Error(
          `cNIGHT minting contracts not found in blueprint. Run 'just build <env>' first.`,
        );
      }
      return {
        twoStage: contracts.cnightMintTwoStage,
        forever: contracts.cnightMintForever,
        logic: contracts.cnightMintLogic,
      };
    default:
      throw new Error(`Unknown two-stage validator: ${validatorName}`);
  }
}

/**
 * Finds a script by its hash.
 * Checks the instance cache first (fast path for v1 hashes), then falls back
 * to a full blueprint module search to cover v2 and other non-standard classes.
 */
export function findScriptByHash(
  hash: string,
  env?: string,
  useBuild?: boolean,
): Script | null {
  const instances = getContractInstances(env, useBuild);
  for (const value of Object.values(instances)) {
    if (value && typeof value === "object" && "Script" in value) {
      const script = (value as ContractClass).Script;
      if (script.hash() === hash) return script;
    }
  }
  // Fallback: search the full blueprint module (handles v2 and other non-standard classes)
  const targetEnv = env ? getConfigSection(env) : "default";
  const Contracts = loadContractModule(targetEnv, useBuild);
  const result = findContractByHash(Contracts, hash);
  return result?.script ?? null;
}

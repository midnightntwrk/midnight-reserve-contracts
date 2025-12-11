import {
  addressFromValidator,
  addressFromCredential,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  Script,
} from "@blaze-cardano/core";
import type { Network } from "./types";
import { getNetworkId } from "./types";
import * as Contracts from "../../contract_blueprint";

export interface ContractInstances {
  // Tech Auth
  techAuthTwoStage: Contracts.PermissionedTechAuthTwoStageUpgradeElse;
  techAuthForever: Contracts.PermissionedTechAuthForeverElse;
  techAuthLogic: Contracts.PermissionedTechAuthLogicElse;

  // Council
  councilTwoStage: Contracts.PermissionedCouncilTwoStageUpgradeElse;
  councilForever: Contracts.PermissionedCouncilForeverElse;
  councilLogic: Contracts.PermissionedCouncilLogicElse;

  // Reserve
  reserveForever: Contracts.ReserveReserveForeverElse;
  reserveTwoStage: Contracts.ReserveReserveTwoStageUpgradeElse;
  reserveLogic: Contracts.ReserveReserveLogicElse;

  // Gov Auth
  govAuth: Contracts.GovAuthMainGovAuthElse;
  stagingGovAuth: Contracts.GovAuthStagingGovAuthElse;

  // ICS
  icsForever: Contracts.IliquidCirculationSupplyIcsForeverElse;
  icsTwoStage: Contracts.IliquidCirculationSupplyIcsTwoStageUpgradeElse;
  icsLogic: Contracts.IliquidCirculationSupplyIcsLogicElse;

  // Federated Ops
  federatedOpsForever: Contracts.PermissionedFederatedOpsForeverElse;
  federatedOpsTwoStage: Contracts.PermissionedFederatedOpsTwoStageUpgradeElse;
  federatedOpsLogic: Contracts.PermissionedFederatedOpsLogicElse;

  // Thresholds
  mainGovThreshold: Contracts.ThresholdsMainGovThresholdElse;
  stagingGovThreshold: Contracts.ThresholdsStagingGovThresholdElse;
  mainCouncilUpdateThreshold: Contracts.ThresholdsMainCouncilUpdateThresholdElse;
  mainTechAuthUpdateThreshold: Contracts.ThresholdsMainTechAuthUpdateThresholdElse;
  mainFederatedOpsUpdateThreshold: Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse;

  // TCnight Mint Infinite (testnet only)
  tcnightMintInfinite: Contracts.TestCnightNoAuditTcnightMintInfiniteElse;

  // Terms and Conditions
  termsAndConditionsForever: Contracts.PermissionedTermsAndConditionsForeverElse;
  termsAndConditionsTwoStage: Contracts.PermissionedTermsAndConditionsTwoStageUpgradeElse;
  termsAndConditionsLogic: Contracts.PermissionedTermsAndConditionsLogicElse;
  termsAndConditionsThreshold: Contracts.ThresholdsTermsAndConditionsThresholdElse;
}

let cachedInstances: ContractInstances | null = null;

export function getContractInstances(): ContractInstances {
  if (cachedInstances) {
    return cachedInstances;
  }

  cachedInstances = {
    // Tech Auth
    techAuthTwoStage: new Contracts.PermissionedTechAuthTwoStageUpgradeElse(),
    techAuthForever: new Contracts.PermissionedTechAuthForeverElse(),
    techAuthLogic: new Contracts.PermissionedTechAuthLogicElse(),

    // Council
    councilTwoStage: new Contracts.PermissionedCouncilTwoStageUpgradeElse(),
    councilForever: new Contracts.PermissionedCouncilForeverElse(),
    councilLogic: new Contracts.PermissionedCouncilLogicElse(),

    // Reserve
    reserveForever: new Contracts.ReserveReserveForeverElse(),
    reserveTwoStage: new Contracts.ReserveReserveTwoStageUpgradeElse(),
    reserveLogic: new Contracts.ReserveReserveLogicElse(),

    // Gov Auth
    govAuth: new Contracts.GovAuthMainGovAuthElse(),
    stagingGovAuth: new Contracts.GovAuthStagingGovAuthElse(),

    // ICS
    icsForever: new Contracts.IliquidCirculationSupplyIcsForeverElse(),
    icsTwoStage: new Contracts.IliquidCirculationSupplyIcsTwoStageUpgradeElse(),
    icsLogic: new Contracts.IliquidCirculationSupplyIcsLogicElse(),

    // Federated Ops
    federatedOpsForever: new Contracts.PermissionedFederatedOpsForeverElse(),
    federatedOpsTwoStage:
      new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse(),
    federatedOpsLogic: new Contracts.PermissionedFederatedOpsLogicElse(),

    // Thresholds
    mainGovThreshold: new Contracts.ThresholdsMainGovThresholdElse(),
    stagingGovThreshold: new Contracts.ThresholdsStagingGovThresholdElse(),
    mainCouncilUpdateThreshold:
      new Contracts.ThresholdsMainCouncilUpdateThresholdElse(),
    mainTechAuthUpdateThreshold:
      new Contracts.ThresholdsMainTechAuthUpdateThresholdElse(),
    mainFederatedOpsUpdateThreshold:
      new Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse(),

    // TCnight Mint Infinite (testnet only)
    tcnightMintInfinite: new Contracts.TestCnightNoAuditTcnightMintInfiniteElse(),

    // Terms and Conditions
    termsAndConditionsForever:
      new Contracts.PermissionedTermsAndConditionsForeverElse(),
    termsAndConditionsTwoStage:
      new Contracts.PermissionedTermsAndConditionsTwoStageUpgradeElse(),
    termsAndConditionsLogic:
      new Contracts.PermissionedTermsAndConditionsLogicElse(),
    termsAndConditionsThreshold:
      new Contracts.ThresholdsTermsAndConditionsThresholdElse(),
  };

  return cachedInstances;
}

export function getContractAddress(
  network: Network,
  script: Script,
): ReturnType<typeof addressFromValidator> {
  const networkId = getNetworkId(network);
  return addressFromValidator(networkId, script);
}

export function getCredentialAddress(
  network: Network,
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

export function getTwoStageContracts(
  validatorName: string,
): TwoStageContracts {
  const contracts = getContractInstances();

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

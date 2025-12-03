import {
  addressFromValidator,
  addressFromCredential,
  Credential,
  CredentialType,
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
      hash: scriptHash as any,
    }),
  );
}

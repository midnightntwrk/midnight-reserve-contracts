export class ContractsManager {
  private C: any;

  constructor() {}

  private async loadContracts() {
    if (!this.C) {
      this.C = await import("../../contract_blueprint.ts");
    }
    return this.C;
  }

  async getTechAuth() {
    const C = await this.loadContracts();
    return {
      twoStage: new C.PermissionedTechAuthTwoStageUpgradeElse(),
      forever: new C.PermissionedTechAuthForeverElse(),
      logic: new C.PermissionedTechAuthLogicElse(),
    };
  }

  async getCouncil() {
    const C = await this.loadContracts();
    return {
      twoStage: new C.PermissionedCouncilTwoStageUpgradeElse(),
      forever: new C.PermissionedCouncilForeverElse(),
      logic: new C.PermissionedCouncilLogicElse(),
    };
  }

  async getReserve() {
    const C = await this.loadContracts();
    return {
      forever: new C.ReserveReserveForeverElse(),
      twoStage: new C.ReserveReserveTwoStageUpgradeElse(),
      logic: new C.ReserveReserveLogicElse(),
    };
  }

  async getICS() {
    const C = await this.loadContracts();
    return {
      forever: new C.IliquidCirculationSupplyIcsForeverElse(),
      twoStage: new C.IliquidCirculationSupplyIcsTwoStageUpgradeElse(),
      logic: new C.IliquidCirculationSupplyIcsLogicElse(),
    };
  }

  async getFederatedOps() {
    const C = await this.loadContracts();
    return {
      forever: new C.PermissionedFederatedOpsForeverElse(),
      twoStage: new C.PermissionedFederatedOpsTwoStageUpgradeElse(),
      logic: new C.PermissionedFederatedOpsLogicElse(),
    };
  }

  async getThresholds() {
    const C = await this.loadContracts();
    return {
      mainGov: new C.ThresholdsMainGovThresholdElse(),
      stagingGov: new C.ThresholdsStagingGovThresholdElse(),
      mainCouncilUpdate: new C.ThresholdsMainCouncilUpdateThresholdElse(),
      mainTechAuthUpdate: new C.ThresholdsMainTechAuthUpdateThresholdElse(),
      mainFederatedOpsUpdate: new C.ThresholdsMainFederatedOpsUpdateThresholdElse(),
    };
  }

  async getGovAuth() {
    const C = await this.loadContracts();
    return new C.GovAuthMainGovAuthElse();
  }
}

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
}

export function getDefaultConfig(): NetworkConfig {
  return {
    technical_authority_one_shot_hash: "0".repeat(63) + "4",
    technical_authority_one_shot_index: 1,
    council_one_shot_hash: "0".repeat(63) + "2",
    council_one_shot_index: 1,
    reserve_one_shot_hash: "0".repeat(63) + "1",
    reserve_one_shot_index: 1,
    ics_one_shot_hash: "0".repeat(63) + "3",
    ics_one_shot_index: 1,
    federated_operators_one_shot_hash: "0".repeat(63) + "5",
    federated_operators_one_shot_index: 1,
    main_gov_one_shot_hash: "0".repeat(63) + "6",
    main_gov_one_shot_index: 1,
    staging_gov_one_shot_hash: "0".repeat(63) + "7",
    staging_gov_one_shot_index: 1,
    main_council_update_one_shot_hash: "0".repeat(63) + "8",
    main_council_update_one_shot_index: 1,
    main_tech_auth_update_one_shot_hash: "0".repeat(63) + "9",
    main_tech_auth_update_one_shot_index: 1,
    main_federated_ops_update_one_shot_hash: "0".repeat(63) + "a",
    main_federated_ops_update_one_shot_index: 1,
  };
}

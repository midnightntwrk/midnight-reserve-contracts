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
      forever: new C.IlliquidCirculationSupplyIcsForeverElse(),
      twoStage: new C.IlliquidCirculationSupplyIcsTwoStageUpgradeElse(),
      logic: new C.IlliquidCirculationSupplyIcsLogicElse(),
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

  async getCnightMinting() {
    const C = await this.loadContracts();
    return {
      forever: new C.CnightMintingCnightMintForeverElse(),
      twoStage: new C.CnightMintingCnightMintTwoStageUpgradeElse(),
      logic: new C.CnightMintingCnightMintLogicElse(),
    };
  }

  async getTermsAndConditions() {
    const C = await this.loadContracts();
    return {
      forever: new C.TermsAndConditionsTermsAndConditionsForeverElse(),
      twoStage: new C.TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse(),
      logic: new C.TermsAndConditionsTermsAndConditionsLogicElse(),
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
      termsAndConditions: new C.ThresholdsTermsAndConditionsThresholdElse(),
    };
  }

  async getGovAuth() {
    const C = await this.loadContracts();
    return new C.GovAuthMainGovAuthElse();
  }

  async getAlwaysFails() {
    const C = await this.loadContracts();
    return new C.AlwaysFailsAlwaysFailsSpend();
  }
}

// Re-export NetworkConfig from provider for convenience
export type { NetworkConfig } from "./provider";

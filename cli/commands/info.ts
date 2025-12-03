import type { InfoOptions } from "../lib/types";
import { getContractInstances, getCredentialAddress } from "../lib/contracts";
import { printTable } from "../utils/output";

interface ContractInfo {
  name: string;
  component: string;
  scriptHash: string;
  address: string;
}

export async function info(options: InfoOptions): Promise<void> {
  const { network, format, component } = options;

  console.log(`\nContract Information for ${network} network\n`);

  const contracts = getContractInstances();

  const allContracts: ContractInfo[] = [
    // Tech Auth
    {
      name: "Tech Auth Forever",
      component: "tech-auth",
      scriptHash: contracts.techAuthForever.Script.hash(),
      address: getCredentialAddress(network, contracts.techAuthForever.Script.hash()).toBech32(),
    },
    {
      name: "Tech Auth Two Stage",
      component: "tech-auth",
      scriptHash: contracts.techAuthTwoStage.Script.hash(),
      address: getCredentialAddress(network, contracts.techAuthTwoStage.Script.hash()).toBech32(),
    },
    {
      name: "Tech Auth Logic",
      component: "tech-auth",
      scriptHash: contracts.techAuthLogic.Script.hash(),
      address: getCredentialAddress(network, contracts.techAuthLogic.Script.hash()).toBech32(),
    },
    {
      name: "Tech Auth Update Threshold",
      component: "tech-auth-threshold",
      scriptHash: contracts.mainTechAuthUpdateThreshold.Script.hash(),
      address: getCredentialAddress(network, contracts.mainTechAuthUpdateThreshold.Script.hash()).toBech32(),
    },

    // Council
    {
      name: "Council Forever",
      component: "council",
      scriptHash: contracts.councilForever.Script.hash(),
      address: getCredentialAddress(network, contracts.councilForever.Script.hash()).toBech32(),
    },
    {
      name: "Council Two Stage",
      component: "council",
      scriptHash: contracts.councilTwoStage.Script.hash(),
      address: getCredentialAddress(network, contracts.councilTwoStage.Script.hash()).toBech32(),
    },
    {
      name: "Council Logic",
      component: "council",
      scriptHash: contracts.councilLogic.Script.hash(),
      address: getCredentialAddress(network, contracts.councilLogic.Script.hash()).toBech32(),
    },
    {
      name: "Council Update Threshold",
      component: "council-threshold",
      scriptHash: contracts.mainCouncilUpdateThreshold.Script.hash(),
      address: getCredentialAddress(network, contracts.mainCouncilUpdateThreshold.Script.hash()).toBech32(),
    },

    // Reserve
    {
      name: "Reserve Forever",
      component: "reserve",
      scriptHash: contracts.reserveForever.Script.hash(),
      address: getCredentialAddress(network, contracts.reserveForever.Script.hash()).toBech32(),
    },
    {
      name: "Reserve Two Stage",
      component: "reserve",
      scriptHash: contracts.reserveTwoStage.Script.hash(),
      address: getCredentialAddress(network, contracts.reserveTwoStage.Script.hash()).toBech32(),
    },
    {
      name: "Reserve Logic",
      component: "reserve",
      scriptHash: contracts.reserveLogic.Script.hash(),
      address: getCredentialAddress(network, contracts.reserveLogic.Script.hash()).toBech32(),
    },

    // ICS
    {
      name: "ICS Forever",
      component: "ics",
      scriptHash: contracts.icsForever.Script.hash(),
      address: getCredentialAddress(network, contracts.icsForever.Script.hash()).toBech32(),
    },
    {
      name: "ICS Two Stage",
      component: "ics",
      scriptHash: contracts.icsTwoStage.Script.hash(),
      address: getCredentialAddress(network, contracts.icsTwoStage.Script.hash()).toBech32(),
    },
    {
      name: "ICS Logic",
      component: "ics",
      scriptHash: contracts.icsLogic.Script.hash(),
      address: getCredentialAddress(network, contracts.icsLogic.Script.hash()).toBech32(),
    },

    // Gov
    {
      name: "Gov Auth",
      component: "gov",
      scriptHash: contracts.govAuth.Script.hash(),
      address: getCredentialAddress(network, contracts.govAuth.Script.hash()).toBech32(),
    },
    {
      name: "Main Gov Threshold",
      component: "main-gov",
      scriptHash: contracts.mainGovThreshold.Script.hash(),
      address: getCredentialAddress(network, contracts.mainGovThreshold.Script.hash()).toBech32(),
    },
    {
      name: "Staging Gov Threshold",
      component: "staging-gov",
      scriptHash: contracts.stagingGovThreshold.Script.hash(),
      address: getCredentialAddress(network, contracts.stagingGovThreshold.Script.hash()).toBech32(),
    },

    // Federated Ops
    {
      name: "Federated Ops Forever",
      component: "federated-ops",
      scriptHash: contracts.federatedOpsForever.Script.hash(),
      address: getCredentialAddress(network, contracts.federatedOpsForever.Script.hash()).toBech32(),
    },
    {
      name: "Federated Ops Two Stage",
      component: "federated-ops",
      scriptHash: contracts.federatedOpsTwoStage.Script.hash(),
      address: getCredentialAddress(network, contracts.federatedOpsTwoStage.Script.hash()).toBech32(),
    },
    {
      name: "Federated Ops Logic",
      component: "federated-ops",
      scriptHash: contracts.federatedOpsLogic.Script.hash(),
      address: getCredentialAddress(network, contracts.federatedOpsLogic.Script.hash()).toBech32(),
    },
    {
      name: "Federated Ops Update Threshold",
      component: "federated-ops-threshold",
      scriptHash: contracts.mainFederatedOpsUpdateThreshold.Script.hash(),
      address: getCredentialAddress(network, contracts.mainFederatedOpsUpdateThreshold.Script.hash()).toBech32(),
    },
  ];

  // Filter by component if specified
  const filteredContracts =
    component === "all"
      ? allContracts
      : allContracts.filter((c) => c.component === component);

  if (format === "json") {
    console.log(JSON.stringify(filteredContracts, null, 2));
  } else {
    // Group by component
    const grouped = new Map<string, ContractInfo[]>();
    for (const contract of filteredContracts) {
      const existing = grouped.get(contract.component) || [];
      existing.push(contract);
      grouped.set(contract.component, existing);
    }

    for (const [comp, contracts] of grouped) {
      console.log(`\n=== ${comp.toUpperCase()} ===`);
      printTable(
        ["Name", "Script Hash", "Address"],
        contracts.map((c) => [
          c.name,
          c.scriptHash.slice(0, 16) + "...",
          c.address.slice(0, 40) + "...",
        ]),
      );
    }

    console.log("\nNote: Use --format json for full hashes and addresses");
  }
}

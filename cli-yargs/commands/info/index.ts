import type { Argv, CommandModule } from "yargs";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import type { GlobalOptions } from "../../lib/global-options";
import {
  getContractInstances,
  getCredentialAddress,
} from "../../lib/contracts";
import { getCardanoNetwork } from "../../lib/network-mapping";
import { printTable } from "../../lib/output";
import {
  blockfrostFetch,
  parseUpgradeStateDatum,
  getBlockfrostBaseUrl,
} from "../../lib/blockfrost";

// --- Types ---

interface ContractInfo {
  name: string;
  component: string;
  scriptHash: string;
  address: string;
}

interface BlockfrostAmount {
  unit: string;
  quantity: string;
}

interface BlockfrostUtxo {
  tx_hash: string;
  tx_index: number;
  output_index: number;
  amount: BlockfrostAmount[];
  inline_datum: string | null;
  data_hash: string | null;
}

interface TokenInfo {
  policyId: string;
  assetName: string;
  assetNameUtf8: string;
  quantity: string;
}

interface UtxoInfo {
  txHash: string;
  outputIndex: number;
  lovelace: string;
  ada: string;
  tokens: TokenInfo[];
  inlineDatum: string | null;
}

interface UpgradeStateInfo {
  logicHash: string;
  authHash: string;
}

interface ContractOnChainInfo extends ContractInfo {
  utxos: UtxoInfo[];
  totalAda: string;
  totalLovelace: string;
  nftTokenNames: string[];
  upgradeState: UpgradeStateInfo | null;
}

interface InfoOptions extends GlobalOptions {
  format: string;
  component: string;
  save: boolean;
  "release-dir": string;
  "use-build": boolean;
}

// --- Constants ---

const MAIN_TRACK_COMPONENTS = [
  "tech-auth",
  "council",
  "reserve",
  "ics",
  "federated-ops",
  "terms-and-conditions",
  "gov",
];

const TWO_STAGE_NAMES = new Set([
  "Tech Auth Two Stage",
  "Council Two Stage",
  "Reserve Two Stage",
  "ICS Two Stage",
  "Federated Ops Two Stage",
  "Terms And Conditions Two Stage",
]);

// --- Helpers ---

async function fetchAddressUtxos(
  baseUrl: string,
  apiKey: string,
  address: string,
): Promise<BlockfrostUtxo[]> {
  const result = await blockfrostFetch(
    baseUrl,
    apiKey,
    `/addresses/${address}/utxos`,
  );
  if (result === null) return [];
  return result as BlockfrostUtxo[];
}

function parseTokensFromAmounts(amounts: BlockfrostAmount[]): TokenInfo[] {
  const tokens: TokenInfo[] = [];
  for (const amt of amounts) {
    if (amt.unit === "lovelace") continue;
    if (amt.unit.length < 56) continue;
    const policyId = amt.unit.slice(0, 56);
    const assetNameHex = amt.unit.slice(56);
    let assetNameUtf8 = "";
    try {
      assetNameUtf8 = Buffer.from(assetNameHex, "hex").toString("utf8");
    } catch {
      assetNameUtf8 = assetNameHex;
    }
    tokens.push({
      policyId,
      assetName: assetNameHex,
      assetNameUtf8,
      quantity: amt.quantity,
    });
  }
  return tokens;
}

function convertUtxo(utxo: BlockfrostUtxo): UtxoInfo {
  const lovelaceAmt = utxo.amount.find((a) => a.unit === "lovelace");
  const lovelace = lovelaceAmt?.quantity ?? "0";
  const ada = (Number(lovelace) / 1_000_000).toFixed(6);

  return {
    txHash: utxo.tx_hash,
    outputIndex: utxo.output_index,
    lovelace,
    ada,
    tokens: parseTokensFromAmounts(utxo.amount),
    inlineDatum: utxo.inline_datum ?? null,
  };
}

async function enrichContractWithOnChainData(
  contract: ContractInfo,
  baseUrl: string,
  apiKey: string,
): Promise<ContractOnChainInfo> {
  const utxos = await fetchAddressUtxos(baseUrl, apiKey, contract.address);
  const utxoInfos = utxos.map(convertUtxo);

  let totalLovelace = 0n;
  const allTokenNames: string[] = [];
  let upgradeState: UpgradeStateInfo | null = null;

  for (const u of utxoInfos) {
    totalLovelace += BigInt(u.lovelace);
    for (const t of u.tokens) {
      if (t.assetNameUtf8) {
        allTokenNames.push(t.assetNameUtf8);
      }
    }
  }

  if (TWO_STAGE_NAMES.has(contract.name)) {
    const mainUtxo = utxoInfos.find((u) =>
      u.tokens.some(
        (t) => t.policyId === contract.scriptHash && t.assetName === "6d61696e",
      ),
    );
    if (mainUtxo?.inlineDatum) {
      upgradeState = parseUpgradeStateDatum(mainUtxo.inlineDatum);
    }
  }

  return {
    ...contract,
    utxos: utxoInfos,
    totalAda: (Number(totalLovelace) / 1_000_000).toFixed(6),
    totalLovelace: totalLovelace.toString(),
    nftTokenNames: allTokenNames,
    upgradeState,
  };
}

function generateMarkdownReport(
  network: string,
  contracts: ContractOnChainInfo[],
): string {
  const mainTrack = contracts.filter((c) =>
    MAIN_TRACK_COMPONENTS.includes(c.component),
  );

  const lines: string[] = [
    `# Contract Address Report`,
    ``,
    `**Network:** ${network}`,
    `**Generated:** ${new Date().toISOString()}`,
    `**Contracts:** ${mainTrack.length}`,
    ``,
    `---`,
    ``,
  ];

  const grouped = new Map<string, ContractOnChainInfo[]>();
  for (const contract of mainTrack) {
    const existing = grouped.get(contract.component) || [];
    existing.push(contract);
    grouped.set(contract.component, existing);
  }

  for (const [comp, contractGroup] of grouped) {
    lines.push(`## ${comp.toUpperCase()}`);
    lines.push(``);

    for (const c of contractGroup) {
      lines.push(`### ${c.name}`);
      lines.push(``);
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| **Address** | \`${c.address}\` |`);
      lines.push(`| **Script Hash** | \`${c.scriptHash}\` |`);
      lines.push(`| **ADA** | ${c.totalAda} |`);

      if (c.nftTokenNames.length > 0) {
        lines.push(
          `| **NFT Tokens** | ${c.nftTokenNames.map((n) => `\`${n}\``).join(", ")} |`,
        );
      }

      if (c.upgradeState) {
        lines.push(
          `| **Active Logic Hash** | \`${c.upgradeState.logicHash}\` |`,
        );
        lines.push(`| **Auth Hash** | \`${c.upgradeState.authHash}\` |`);
      }

      if (c.utxos.length > 0) {
        const datumSummaries: string[] = [];
        for (const u of c.utxos) {
          if (u.inlineDatum) {
            if (c.upgradeState) {
              datumSummaries.push(
                `UpgradeState(logic=${c.upgradeState.logicHash.slice(0, 16)}...)`,
              );
            } else {
              datumSummaries.push(
                `Inline datum present (${u.inlineDatum.length / 2} bytes)`,
              );
            }
          }
        }
        if (datumSummaries.length > 0) {
          lines.push(`| **Datum** | ${datumSummaries.join("; ")} |`);
        }
      }

      lines.push(``);
    }
  }

  return lines.join("\n");
}

function buildContractList(network: string, useBuild: boolean): ContractInfo[] {
  const contracts = getContractInstances(network, useBuild);

  return [
    // Tech Auth
    {
      name: "Tech Auth Forever",
      component: "tech-auth",
      scriptHash: contracts.techAuthForever.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.techAuthForever.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Tech Auth Two Stage",
      component: "tech-auth",
      scriptHash: contracts.techAuthTwoStage.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.techAuthTwoStage.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Tech Auth Logic",
      component: "tech-auth",
      scriptHash: contracts.techAuthLogic.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.techAuthLogic.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Tech Auth Update Threshold",
      component: "tech-auth-threshold",
      scriptHash: contracts.mainTechAuthUpdateThreshold.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.mainTechAuthUpdateThreshold.Script.hash(),
      ).toBech32(),
    },

    // Council
    {
      name: "Council Forever",
      component: "council",
      scriptHash: contracts.councilForever.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.councilForever.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Council Two Stage",
      component: "council",
      scriptHash: contracts.councilTwoStage.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.councilTwoStage.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Council Logic",
      component: "council",
      scriptHash: contracts.councilLogic.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.councilLogic.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Council Update Threshold",
      component: "council-threshold",
      scriptHash: contracts.mainCouncilUpdateThreshold.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.mainCouncilUpdateThreshold.Script.hash(),
      ).toBech32(),
    },

    // Reserve
    {
      name: "Reserve Forever",
      component: "reserve",
      scriptHash: contracts.reserveForever.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.reserveForever.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Reserve Two Stage",
      component: "reserve",
      scriptHash: contracts.reserveTwoStage.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.reserveTwoStage.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Reserve Logic",
      component: "reserve",
      scriptHash: contracts.reserveLogic.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.reserveLogic.Script.hash(),
      ).toBech32(),
    },

    // ICS
    {
      name: "ICS Forever",
      component: "ics",
      scriptHash: contracts.icsForever.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.icsForever.Script.hash(),
      ).toBech32(),
    },
    {
      name: "ICS Two Stage",
      component: "ics",
      scriptHash: contracts.icsTwoStage.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.icsTwoStage.Script.hash(),
      ).toBech32(),
    },
    {
      name: "ICS Logic",
      component: "ics",
      scriptHash: contracts.icsLogic.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.icsLogic.Script.hash(),
      ).toBech32(),
    },

    // Gov
    {
      name: "Gov Auth",
      component: "gov",
      scriptHash: contracts.govAuth.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.govAuth.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Main Gov Threshold",
      component: "main-gov",
      scriptHash: contracts.mainGovThreshold.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.mainGovThreshold.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Staging Gov Threshold",
      component: "staging-gov",
      scriptHash: contracts.stagingGovThreshold.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.stagingGovThreshold.Script.hash(),
      ).toBech32(),
    },

    // Federated Ops
    {
      name: "Federated Ops Forever",
      component: "federated-ops",
      scriptHash: contracts.federatedOpsForever.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.federatedOpsForever.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Federated Ops Two Stage",
      component: "federated-ops",
      scriptHash: contracts.federatedOpsTwoStage.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.federatedOpsTwoStage.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Federated Ops Logic",
      component: "federated-ops",
      scriptHash: contracts.federatedOpsLogic.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.federatedOpsLogic.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Federated Ops Update Threshold",
      component: "federated-ops-threshold",
      scriptHash: contracts.mainFederatedOpsUpdateThreshold.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.mainFederatedOpsUpdateThreshold.Script.hash(),
      ).toBech32(),
    },

    // Terms and Conditions
    {
      name: "Terms And Conditions Forever",
      component: "terms-and-conditions",
      scriptHash: contracts.termsAndConditionsForever.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.termsAndConditionsForever.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Terms And Conditions Two Stage",
      component: "terms-and-conditions",
      scriptHash: contracts.termsAndConditionsTwoStage.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.termsAndConditionsTwoStage.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Terms And Conditions Logic",
      component: "terms-and-conditions",
      scriptHash: contracts.termsAndConditionsLogic.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.termsAndConditionsLogic.Script.hash(),
      ).toBech32(),
    },
    {
      name: "Terms And Conditions Threshold",
      component: "terms-and-conditions-threshold",
      scriptHash: contracts.termsAndConditionsThreshold.Script.hash(),
      address: getCredentialAddress(
        network,
        contracts.termsAndConditionsThreshold.Script.hash(),
      ).toBech32(),
    },
  ];
}

// --- Command ---

export const command = "info";
export const describe = "Display contract information";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("format", {
      type: "string",
      default: "table",
      choices: ["json", "table"],
      description: "Output format: json or table",
    })
    .option("component", {
      type: "string",
      default: "all",
      description: "Filter by component (e.g., tech-auth, council, reserve)",
    })
    .option("save", {
      type: "boolean",
      default: false,
      description:
        "Fetch on-chain data and save JSON + markdown report to release directory",
    })
    .option("release-dir", {
      type: "string",
      default: "./release",
      description: "Base directory for --save output",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use build output instead of deployed blueprint",
    });
}

export async function handler(argv: InfoOptions) {
  const {
    network,
    format,
    component,
    save,
    "release-dir": releaseDir,
    "use-build": useBuild,
  } = argv;

  if (format !== "json" && !save) {
    console.log(`\nContract Information for ${network} network\n`);
  }

  const allContracts = buildContractList(network, useBuild);

  const filteredContracts =
    component === "all"
      ? allContracts
      : allContracts.filter((c) => c.component === component);

  // --save mode: fetch on-chain data and write files
  if (save) {
    const cardanoNetwork = getCardanoNetwork(network);
    if (!cardanoNetwork) {
      throw new Error(
        `Cannot fetch on-chain data for environment '${network}': no real Cardano network mapped. ` +
          `Use a real network like preview, preprod, or mainnet.`,
      );
    }

    const apiKeyVar = `BLOCKFROST_${cardanoNetwork.toUpperCase()}_API_KEY`;
    const apiKey = process.env[apiKeyVar];
    if (!apiKey) {
      throw new Error(
        `Environment variable ${apiKeyVar} is required for --save but not set.`,
      );
    }

    const baseUrl = getBlockfrostBaseUrl(cardanoNetwork);

    console.log(
      `Fetching on-chain data for ${filteredContracts.length} contracts on ${network}...`,
    );

    const enriched: ContractOnChainInfo[] = [];
    for (const contract of filteredContracts) {
      process.stdout.write(`  ${contract.name}...`);
      const enrichedContract = await enrichContractWithOnChainData(
        contract,
        baseUrl,
        apiKey,
      );
      console.log(
        ` ${enrichedContract.totalAda} ADA, ${enrichedContract.utxos.length} UTxO(s)`,
      );
      enriched.push(enrichedContract);
    }

    const outputDir = resolve(releaseDir, network);
    mkdirSync(outputDir, { recursive: true });

    // Write JSON
    const jsonPath = resolve(outputDir, "info.json");
    writeFileSync(jsonPath, JSON.stringify(enriched, null, 2), "utf8");
    console.log(`\nJSON saved to ${jsonPath}`);

    // Write markdown report
    const mdReport = generateMarkdownReport(network, enriched);
    const mdPath = resolve(outputDir, "address-report.md");
    writeFileSync(mdPath, mdReport, "utf8");
    console.log(`Markdown report saved to ${mdPath}`);

    return;
  }

  // Standard display mode (no --save)
  if (format === "json") {
    console.log(JSON.stringify(filteredContracts, null, 2));
  } else {
    const grouped = new Map<string, ContractInfo[]>();
    for (const contract of filteredContracts) {
      const existing = grouped.get(contract.component) || [];
      existing.push(contract);
      grouped.set(contract.component, existing);
    }

    for (const [comp, contractGroup] of grouped) {
      console.log(`\n=== ${comp.toUpperCase()} ===`);
      printTable(
        ["Name", "Script Hash", "Address"],
        contractGroup.map((c) => [
          c.name,
          c.scriptHash.slice(0, 16) + "...",
          c.address.slice(0, 40) + "...",
        ]),
      );
    }

    console.log("\nNote: Use --format json for full hashes and addresses");
  }
}

const commandModule: CommandModule<GlobalOptions, InfoOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

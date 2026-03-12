import type { Argv, CommandModule } from "yargs";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import type { GlobalOptions } from "../../lib/global-options";
import {
  getContractInstances,
  getCredentialAddress,
} from "../../lib/contracts";
import { getCardanoNetwork } from "../../lib/network-mapping";
import { printTable, formatLovelaceToAda } from "../../lib/output";
import {
  blockfrostFetch,
  parseUpgradeStateDatum,
  getBlockfrostBaseUrl,
  parseBlockfrostAddressUtxos,
  type BlockfrostAddressUtxo,
} from "../../lib/blockfrost";

// --- Types ---

interface ContractInfo {
  name: string;
  component: string;
  scriptHash: string;
  address: string;
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
  "registered-candidate",
  "cnight-generates-dust",
] as const;

const INFO_COMPONENT_CHOICES = [
  "all",
  "tech-auth",
  "tech-auth-threshold",
  "council",
  "council-threshold",
  "reserve",
  "ics",
  "gov",
  "registered-candidate",
  "cnight-generates-dust",
  "main-gov",
  "staging-gov",
  "federated-ops",
  "federated-ops-threshold",
  "terms-and-conditions",
  "terms-and-conditions-threshold",
] as const;

const SUMMARY_ONLY_COMPONENTS = new Set([
  "registered-candidate",
  "cnight-generates-dust",
] as const);

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
): Promise<BlockfrostAddressUtxo[]> {
  const responsePath = `/addresses/${address}/utxos`;
  const result = await blockfrostFetch(baseUrl, apiKey, responsePath);
  if (result === null) return [];
  return parseBlockfrostAddressUtxos(result, responsePath);
}

function parseTokensFromAmounts(
  amounts: BlockfrostAddressUtxo["amount"],
): TokenInfo[] {
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

function convertUtxo(utxo: BlockfrostAddressUtxo): UtxoInfo {
  const lovelaceAmt = utxo.amount.find((a) => a.unit === "lovelace");
  const lovelace = lovelaceAmt?.quantity ?? "0";
  const ada = formatLovelaceToAda(BigInt(lovelace));

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
    totalAda: formatLovelaceToAda(totalLovelace),
    totalLovelace: totalLovelace.toString(),
    nftTokenNames: allTokenNames,
    upgradeState,
  };
}

export function generateMarkdownReport(
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
      const summaryOnly = SUMMARY_ONLY_COMPONENTS.has(c.component);

      lines.push(`### ${c.name}`);
      lines.push(``);
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| **Address** | \`${c.address}\` |`);
      lines.push(`| **Script Hash** | \`${c.scriptHash}\` |`);
      lines.push(`| **ADA** | ${c.totalAda} |`);

      if (!summaryOnly && c.nftTokenNames.length > 0) {
        lines.push(
          `| **NFT Tokens** | ${c.nftTokenNames.map((n) => `\`${n}\``).join(", ")} |`,
        );
      }

      if (!summaryOnly && c.upgradeState) {
        lines.push(
          `| **Active Logic Hash** | \`${c.upgradeState.logicHash}\` |`,
        );
        lines.push(`| **Auth Hash** | \`${c.upgradeState.authHash}\` |`);
      }

      if (!summaryOnly && c.utxos.length > 0) {
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

function createContractInfo(
  network: string,
  name: string,
  component: string,
  contract: { Script: { hash(): string } },
): ContractInfo {
  const scriptHash = contract.Script.hash();

  return {
    name,
    component,
    scriptHash,
    address: getCredentialAddress(network, scriptHash).toBech32(),
  };
}

export function buildContractList(
  network: string,
  useBuild: boolean,
  contractSource = getContractInstances,
): ContractInfo[] {
  const contracts = contractSource(network, useBuild);

  return [
    // Tech Auth
    createContractInfo(
      network,
      "Tech Auth Forever",
      "tech-auth",
      contracts.techAuthForever,
    ),
    createContractInfo(
      network,
      "Tech Auth Two Stage",
      "tech-auth",
      contracts.techAuthTwoStage,
    ),
    createContractInfo(
      network,
      "Tech Auth Logic",
      "tech-auth",
      contracts.techAuthLogic,
    ),
    createContractInfo(
      network,
      "Tech Auth Update Threshold",
      "tech-auth-threshold",
      contracts.mainTechAuthUpdateThreshold,
    ),

    // Council
    createContractInfo(
      network,
      "Council Forever",
      "council",
      contracts.councilForever,
    ),
    createContractInfo(
      network,
      "Council Two Stage",
      "council",
      contracts.councilTwoStage,
    ),
    createContractInfo(
      network,
      "Council Logic",
      "council",
      contracts.councilLogic,
    ),
    createContractInfo(
      network,
      "Council Update Threshold",
      "council-threshold",
      contracts.mainCouncilUpdateThreshold,
    ),

    // Reserve
    createContractInfo(
      network,
      "Reserve Forever",
      "reserve",
      contracts.reserveForever,
    ),
    createContractInfo(
      network,
      "Reserve Two Stage",
      "reserve",
      contracts.reserveTwoStage,
    ),
    createContractInfo(
      network,
      "Reserve Logic",
      "reserve",
      contracts.reserveLogic,
    ),

    // ICS
    createContractInfo(network, "ICS Forever", "ics", contracts.icsForever),
    createContractInfo(network, "ICS Two Stage", "ics", contracts.icsTwoStage),
    createContractInfo(network, "ICS Logic", "ics", contracts.icsLogic),

    // Gov
    createContractInfo(network, "Gov Auth", "gov", contracts.govAuth),
    createContractInfo(
      network,
      "Main Gov Threshold",
      "main-gov",
      contracts.mainGovThreshold,
    ),
    createContractInfo(
      network,
      "Staging Gov Threshold",
      "staging-gov",
      contracts.stagingGovThreshold,
    ),
    ...(contracts.registeredCandidate
      ? [
          createContractInfo(
            network,
            "Registered Candidate",
            "registered-candidate",
            contracts.registeredCandidate,
          ),
        ]
      : []),

    // Federated Ops
    createContractInfo(
      network,
      "Federated Ops Forever",
      "federated-ops",
      contracts.federatedOpsForever,
    ),
    createContractInfo(
      network,
      "Federated Ops Two Stage",
      "federated-ops",
      contracts.federatedOpsTwoStage,
    ),
    createContractInfo(
      network,
      "Federated Ops Logic",
      "federated-ops",
      contracts.federatedOpsLogic,
    ),
    createContractInfo(
      network,
      "Federated Ops Update Threshold",
      "federated-ops-threshold",
      contracts.mainFederatedOpsUpdateThreshold,
    ),

    // Terms and Conditions
    createContractInfo(
      network,
      "Terms And Conditions Forever",
      "terms-and-conditions",
      contracts.termsAndConditionsForever,
    ),
    createContractInfo(
      network,
      "Terms And Conditions Two Stage",
      "terms-and-conditions",
      contracts.termsAndConditionsTwoStage,
    ),
    createContractInfo(
      network,
      "Terms And Conditions Logic",
      "terms-and-conditions",
      contracts.termsAndConditionsLogic,
    ),
    createContractInfo(
      network,
      "Terms And Conditions Threshold",
      "terms-and-conditions-threshold",
      contracts.termsAndConditionsThreshold,
    ),
    ...(contracts.cnightGeneratesDust
      ? [
          createContractInfo(
            network,
            "cNIGHT Generates Dust",
            "cnight-generates-dust",
            contracts.cnightGeneratesDust,
          ),
        ]
      : []),
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
      choices: INFO_COMPONENT_CHOICES,
      description: "Filter by component",
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

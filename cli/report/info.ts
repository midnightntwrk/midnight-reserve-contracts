import { resolve } from "path";
import {
  Address,
  type NetworkId,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect } from "effect";
import {
  credentialAddress,
  type ContractClass,
  type ContractInstances,
  type RequiredInstance,
  Blueprint,
} from "../contracts/contracts";
import { environmentOf } from "../config/network-mapping";
import { formatTable, formatLovelaceToAda, Output } from "../output";
import {
  findMainUtxo,
  type UpgradeState,
  upgradeStateAt,
} from "../chain/governance-provider";
import { Provider, requireOnChainNetwork } from "../chain/provider";
import { type Format, type NetworkInput } from "../input";

interface ContractInfo {
  name: string;
  component: ContractComponent;
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

interface ContractOnChainInfo extends ContractInfo {
  utxos: UtxoInfo[];
  totalAda: string;
  totalLovelace: string;
  nftTokenNames: string[];
  upgradeState: UpgradeState | null;
}

export const INFO_COMPONENT_CHOICES = [
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
  "cnight-minting",
] as const;

type InfoComponent = (typeof INFO_COMPONENT_CHOICES)[number];

/** The contracts to show, and how: a table, JSON, or with save their UTxOs written under the release directory. */
export interface InfoInput extends NetworkInput {
  readonly format: Format;
  readonly component: InfoComponent;
  readonly save: boolean;
  readonly releaseDir: string;
}
type ContractComponent = Exclude<InfoComponent, "all">;

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
  "cnight-minting",
] as const satisfies readonly ContractComponent[];

type MainTrackComponent = (typeof MAIN_TRACK_COMPONENTS)[number];

const SUMMARY_ONLY_COMPONENTS = [
  "registered-candidate",
  "cnight-generates-dust",
] as const satisfies readonly ContractComponent[];

type SummaryOnlyComponent = (typeof SUMMARY_ONLY_COMPONENTS)[number];

const MAIN_TRACK_COMPONENT_SET: ReadonlySet<ContractComponent> = new Set(
  MAIN_TRACK_COMPONENTS,
);

const SUMMARY_ONLY_COMPONENT_SET: ReadonlySet<ContractComponent> = new Set(
  SUMMARY_ONLY_COMPONENTS,
);

/** Every contract info shows, in display order: its name, component and blueprint instance. */
const CONTRACTS: readonly (readonly [
  string,
  ContractComponent,
  RequiredInstance,
])[] = [
  ["Tech Auth Forever", "tech-auth", "techAuthForever"],
  ["Tech Auth Two Stage", "tech-auth", "techAuthTwoStage"],
  ["Tech Auth Logic", "tech-auth", "techAuthLogic"],
  [
    "Tech Auth Update Threshold",
    "tech-auth-threshold",
    "mainTechAuthUpdateThreshold",
  ],
  ["Council Forever", "council", "councilForever"],
  ["Council Two Stage", "council", "councilTwoStage"],
  ["Council Logic", "council", "councilLogic"],
  [
    "Council Update Threshold",
    "council-threshold",
    "mainCouncilUpdateThreshold",
  ],
  ["Reserve Forever", "reserve", "reserveForever"],
  ["Reserve Two Stage", "reserve", "reserveTwoStage"],
  ["Reserve Logic", "reserve", "reserveLogic"],
  ["ICS Forever", "ics", "icsForever"],
  ["ICS Two Stage", "ics", "icsTwoStage"],
  ["ICS Logic", "ics", "icsLogic"],
  ["Gov Auth", "gov", "govAuth"],
  ["Main Gov Threshold", "main-gov", "mainGovThreshold"],
  ["Staging Gov Threshold", "staging-gov", "stagingGovThreshold"],
  ["Registered Candidate", "registered-candidate", "registeredCandidate"],
  ["Federated Ops Forever", "federated-ops", "federatedOpsForever"],
  ["Federated Ops Two Stage", "federated-ops", "federatedOpsTwoStage"],
  ["Federated Ops Logic", "federated-ops", "federatedOpsLogic"],
  [
    "Federated Ops Update Threshold",
    "federated-ops-threshold",
    "mainFederatedOpsUpdateThreshold",
  ],
  [
    "Terms And Conditions Forever",
    "terms-and-conditions",
    "termsAndConditionsForever",
  ],
  [
    "Terms And Conditions Two Stage",
    "terms-and-conditions",
    "termsAndConditionsTwoStage",
  ],
  [
    "Terms And Conditions Logic",
    "terms-and-conditions",
    "termsAndConditionsLogic",
  ],
  [
    "Terms And Conditions Threshold",
    "terms-and-conditions-threshold",
    "termsAndConditionsThreshold",
  ],
  ["cNIGHT Generates Dust", "cnight-generates-dust", "cnightGeneratesDust"],
];

/** The contracts info shows only where the blueprint has them: cNIGHT minting. */
const OPTIONAL_CONTRACTS: readonly (readonly [
  string,
  ContractComponent,
  Exclude<keyof ContractInstances, RequiredInstance>,
])[] = [
  ["cNIGHT Mint Forever", "cnight-minting", "cnightMintForever"],
  ["cNIGHT Mint Two Stage", "cnight-minting", "cnightMintTwoStage"],
  ["cNIGHT Mint Logic", "cnight-minting", "cnightMintLogic"],
];

const TWO_STAGE_NAMES = new Set(
  [...CONTRACTS, ...OPTIONAL_CONTRACTS]
    .filter(([, , key]) => key.endsWith("TwoStage"))
    .map(([name]) => name),
);

function isMainTrackComponent(
  component: ContractComponent,
): component is MainTrackComponent {
  return MAIN_TRACK_COMPONENT_SET.has(component);
}

function isSummaryOnlyComponent(
  component: ContractComponent,
): component is SummaryOnlyComponent {
  return SUMMARY_ONLY_COMPONENT_SET.has(component);
}

/** The info fields of one UTxO: its reference, lovelace, tokens and inline datum. */
const utxoInfo = (utxo: TransactionUnspentOutput): UtxoInfo => {
  const amount = utxo.output().amount();
  return {
    txHash: utxo.input().transactionId(),
    outputIndex: Number(utxo.input().index()),
    lovelace: amount.coin().toString(),
    ada: formatLovelaceToAda(amount.coin()),
    tokens: [...(amount.multiasset() ?? [])].map(([assetId, quantity]) => ({
      policyId: assetId.slice(0, 56),
      assetName: assetId.slice(56),
      assetNameUtf8: Buffer.from(assetId.slice(56), "hex").toString("utf8"),
      quantity: quantity.toString(),
    })),
    inlineDatum: utxo.output().datum()?.asInlineData()?.toCbor() ?? null,
  };
};

/** The contract with all its UTxOs, totals, NFT names and, for a two-stage contract, the main UpgradeState. */
const enrichContract = (contract: ContractInfo) =>
  Effect.gen(function* () {
    const provider = yield* Provider;
    const utxos = yield* provider.unspentOutputs(
      Address.fromBech32(contract.address),
    );
    const utxoInfos = utxos.map(utxoInfo);
    const main = TWO_STAGE_NAMES.has(contract.name)
      ? findMainUtxo(utxos, contract.scriptHash)
      : undefined;
    const upgradeState =
      main?.output().datum()?.asInlineData() === undefined
        ? null
        : yield* upgradeStateAt(main);
    const totalLovelace = utxos.reduce(
      (sum, u) => sum + u.output().amount().coin(),
      0n,
    );
    return {
      ...contract,
      utxos: utxoInfos,
      totalAda: formatLovelaceToAda(totalLovelace),
      totalLovelace: totalLovelace.toString(),
      nftTokenNames: utxoInfos.flatMap((u) =>
        u.tokens.flatMap((t) => (t.assetNameUtf8 ? [t.assetNameUtf8] : [])),
      ),
      upgradeState,
    } satisfies ContractOnChainInfo;
  });

function generateMarkdownReport(
  network: string,
  contracts: ContractOnChainInfo[],
): string {
  const mainTrack = contracts.filter((c) => isMainTrackComponent(c.component));

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
      const summaryOnly = isSummaryOnlyComponent(c.component);

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

/** Every contract of the blueprint in display order, with its address on the network; an optional one only where the blueprint has it. */
const contractList = (
  networkId: NetworkId,
  contracts: ContractInstances,
): ContractInfo[] => {
  const info = (
    name: string,
    component: ContractComponent,
    contract: ContractClass,
  ): ContractInfo => {
    const scriptHash = contract.Script.hash();
    const address = credentialAddress(networkId, scriptHash).toBech32();
    return { name, component, scriptHash, address };
  };
  return [
    ...CONTRACTS.map(([name, component, key]) =>
      info(name, component, contracts[key]),
    ),
    ...OPTIONAL_CONTRACTS.flatMap(([name, component, key]) => {
      const contract = contracts[key];
      return contract ? [info(name, component, contract)] : [];
    }),
  ];
};

/** List the contracts of the blueprint; with --save, read their UTxOs and write info.json and the markdown report. */
export const infoProgram = (input: InfoInput) =>
  Effect.gen(function* () {
    const { network, format, component, save, releaseDir } = input;
    const output = yield* Output;

    if (format !== "json" && !save) {
      yield* output.log(`\nContract Information for ${network} network\n`);
    }

    const { networkId } = environmentOf(network);
    const contracts = yield* Effect.flatMap(Blueprint, (b) => b.instances);
    const allContracts = contractList(networkId, contracts);
    const filteredContracts =
      component === "all"
        ? allContracts
        : allContracts.filter((c) => c.component === component);

    if (save) {
      yield* requireOnChainNetwork(network);
      yield* output.log(
        `Fetching on-chain data for ${filteredContracts.length} contracts on ${network}...`,
      );
      const enriched = yield* Effect.forEach(filteredContracts, (contract) =>
        Effect.tap(enrichContract(contract), (info) =>
          output.log(
            `  ${info.name}... ${info.totalAda} ADA, ${info.utxos.length} UTxO(s)`,
          ),
        ),
      );

      const outputDir = resolve(releaseDir, network);
      const jsonPath = resolve(outputDir, "info.json");
      yield* output.writeJson(jsonPath, enriched);
      yield* output.log(`\nJSON saved to ${jsonPath}`);
      const mdPath = resolve(outputDir, "address-report.md");
      yield* output.writeText(
        mdPath,
        generateMarkdownReport(network, enriched),
      );
      yield* output.log(`Markdown report saved to ${mdPath}`);
      return enriched;
    }

    if (format === "json") {
      yield* output.log(JSON.stringify(filteredContracts, null, 2));
      return filteredContracts;
    }

    const grouped = new Map<string, ContractInfo[]>();
    for (const contract of filteredContracts) {
      const existing = grouped.get(contract.component) || [];
      existing.push(contract);
      grouped.set(contract.component, existing);
    }
    for (const [comp, contractGroup] of grouped) {
      yield* output.log(`\n=== ${comp.toUpperCase()} ===`);
      const lines = formatTable(
        ["Name", "Script Hash", "Address"],
        contractGroup.map((c) => [
          c.name,
          c.scriptHash,
          `${c.address.slice(0, 16)}...${c.address.slice(-8)}`,
        ]),
      );
      for (const line of lines) yield* output.log(line);
    }
    yield* output.log("\nNote: Use --format json for full addresses");
    return filteredContracts;
  });

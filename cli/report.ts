/**
 * Reports: info (the contracts of the record or the build, and with --save
 * their unspent outputs), verify (the deployed record against the chain) and
 * dust-participants. They read the chain and write files under release/;
 * none builds a transaction.
 */
import { dirname, resolve } from "path";
import {
  Address,
  addressFromCredential,
  AssetId,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  type NetworkId,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, FileSystem, Option, Result } from "effect";
import { Provider } from "./chain";
import { type Environment, environmentOf } from "./config";
import {
  type ContractInstances,
  ContractResolver,
  type DeployedRecord,
} from "./contracts/resolver";
import {
  ConfigError,
  FileWriteError,
  renderError,
  VerificationFailed,
} from "./errors";
import {
  findMainUtxo,
  isTrackLogic,
  MAIN_TOKEN_HEX,
  rawUpgradeStateAt,
  STAGING_TOKEN_HEX,
  type UpgradeState,
  upgradeStateAt,
} from "./governance/two-stage";
import { formatLovelaceToAda, Output } from "./output";

/** The output formats of info and dust-participants. */
export const FORMATS = ["json", "table"] as const;
export type Format = (typeof FORMATS)[number];

/** The enterprise address of a script on the network. */
const scriptAddress = (networkId: NetworkId, scriptHash: string) =>
  addressFromCredential(
    networkId,
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(scriptHash),
    }),
  );

/** A report that reads the chain runs only on a public network; local and the emulator are refused. */
const requireOnChainNetwork = (environment: Environment) =>
  environment === "local" || environment === "emulator"
    ? Effect.fail(
        new ConfigError({
          source: "env",
          key: "--network",
          reason: `Cannot query on-chain data for environment '${environment}'. Use a real network like preview, preprod, or mainnet.`,
        }),
      )
    : Effect.void;

/** Write a report file, creating its directory. */
const writeReport = (path: string, text: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.mapError(
      Effect.andThen(
        fs.makeDirectory(dirname(path), { recursive: true }),
        fs.writeFileString(path, text),
      ),
      (cause) => new FileWriteError({ path, reason: cause.message }),
    ),
  );

/** A text table: separator, header, separator, rows, separator. */
export const formatTable = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string[] => {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const separator = widths.map((w) => "-".repeat(w + 2)).join("+");
  const formatRow = (row: readonly string[]) =>
    row.map((cell, i) => ` ${cell.padEnd(widths[i])} `).join("|");
  return [
    separator,
    formatRow(headers),
    separator,
    ...rows.map(formatRow),
    separator,
  ];
};

// info

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

type ContractComponent = Exclude<
  (typeof INFO_COMPONENT_CHOICES)[number],
  "all"
>;

/** The components of the markdown report; the others are thresholds and gov thresholds. */
const MAIN_TRACK_COMPONENTS: ReadonlySet<ContractComponent> = new Set([
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
]);

/** Components the markdown report shows as address, hash and ADA only. */
const SUMMARY_ONLY_COMPONENTS: ReadonlySet<ContractComponent> = new Set([
  "registered-candidate",
  "cnight-generates-dust",
]);

/** Every contract info shows, in display order; the cNIGHT minting ones only where the blueprint has them. */
const CONTRACTS: readonly (readonly [
  string,
  ContractComponent,
  keyof ContractInstances,
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
  ["cNIGHT Mint Forever", "cnight-minting", "cnightMintForever"],
  ["cNIGHT Mint Two Stage", "cnight-minting", "cnightMintTwoStage"],
  ["cNIGHT Mint Logic", "cnight-minting", "cnightMintLogic"],
];

interface ContractInfo {
  readonly name: string;
  readonly component: ContractComponent;
  readonly scriptHash: string;
  readonly address: string;
}

interface UtxoInfo {
  readonly txHash: string;
  readonly outputIndex: number;
  readonly lovelace: string;
  readonly ada: string;
  readonly tokens: readonly {
    readonly policyId: string;
    readonly assetName: string;
    readonly assetNameUtf8: string;
    readonly quantity: string;
  }[];
  readonly inlineDatum: string | null;
}

interface ContractOnChainInfo extends ContractInfo {
  readonly utxos: readonly UtxoInfo[];
  readonly totalAda: string;
  readonly totalLovelace: string;
  readonly nftTokenNames: readonly string[];
  readonly upgradeState: UpgradeState | null;
}

/** The contract with its unspent outputs, totals, NFT names and, for a two-stage contract, the main UpgradeState. */
const enrichContract = (contract: ContractInfo, twoStage: boolean) =>
  Effect.gen(function* () {
    const provider = yield* Provider;
    const utxos = yield* provider.unspentOutputs(
      Address.fromBech32(contract.address),
    );
    const utxoInfos = utxos.map((utxo): UtxoInfo => {
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
    });
    const main = twoStage
      ? findMainUtxo(utxos, contract.scriptHash)
      : undefined;
    const upgradeState =
      main?.output().datum()?.asInlineData() === undefined
        ? null
        : yield* upgradeStateAt(main);
    const totalLovelace = utxos.reduce(
      (sum, utxo) => sum + utxo.output().amount().coin(),
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

/** The markdown address report of the main-track contracts. */
const addressReport = (
  network: string,
  contracts: readonly ContractOnChainInfo[],
): string => {
  const mainTrack = contracts.filter((c) =>
    MAIN_TRACK_COMPONENTS.has(c.component),
  );
  const lines = [
    `# Contract Address Report`,
    ``,
    `**Network:** ${network}`,
    `**Generated:** ${new Date().toISOString()}`,
    `**Contracts:** ${mainTrack.length}`,
    ``,
    `---`,
    ``,
  ];
  for (const [component, group] of Map.groupBy(mainTrack, (c) => c.component)) {
    lines.push(`## ${component.toUpperCase()}`, ``);
    for (const c of group) {
      const details = !SUMMARY_ONLY_COMPONENTS.has(c.component);
      lines.push(
        `### ${c.name}`,
        ``,
        `| Field | Value |`,
        `|-------|-------|`,
        `| **Address** | \`${c.address}\` |`,
        `| **Script Hash** | \`${c.scriptHash}\` |`,
        `| **ADA** | ${c.totalAda} |`,
      );
      if (details && c.nftTokenNames.length > 0) {
        lines.push(
          `| **NFT Tokens** | ${c.nftTokenNames.map((n) => `\`${n}\``).join(", ")} |`,
        );
      }
      if (details && c.upgradeState) {
        lines.push(
          `| **Active Logic Hash** | \`${c.upgradeState.logicHash}\` |`,
          `| **Auth Hash** | \`${c.upgradeState.authHash}\` |`,
        );
      }
      if (details) {
        const datums = c.utxos.flatMap((u) =>
          u.inlineDatum === null
            ? []
            : [
                c.upgradeState
                  ? `UpgradeState(logic=${c.upgradeState.logicHash.slice(0, 16)}...)`
                  : `Inline datum present (${u.inlineDatum.length / 2} bytes)`,
              ],
        );
        if (datums.length > 0) {
          lines.push(`| **Datum** | ${datums.join("; ")} |`);
        }
      }
      lines.push(``);
    }
  }
  return lines.join("\n");
};

/** List the contracts of the record (or the build with --use-build); with --save, read their unspent outputs and write info.json and the markdown report. */
export const infoProgram = (input: {
  readonly network: Environment;
  readonly useBuild: boolean;
  readonly format: Format;
  readonly component: (typeof INFO_COMPONENT_CHOICES)[number];
  readonly save: boolean;
  readonly releaseDir: string;
}) =>
  Effect.gen(function* () {
    const { network, format, component, save, releaseDir } = input;
    const output = yield* Output;
    if (format !== "json" && !save) {
      yield* output.log(`\nContract Information for ${network} network\n`);
    }
    const { networkId } = environmentOf(network);
    const resolver = yield* ContractResolver;
    // --use-build shows the build, which is where a command that creates contracts takes them from.
    const instances = yield* resolver.contracts(
      input.useBuild ? "creates" : "actsOn",
    ).instances;
    const contracts = CONTRACTS.flatMap(([name, kind, key]) => {
      const contract = instances[key];
      if (contract === undefined || (component !== "all" && kind !== component))
        return [];
      const scriptHash = contract.Script.hash();
      return [
        {
          name,
          component: kind,
          scriptHash,
          address: scriptAddress(networkId, scriptHash).toBech32(),
          twoStage: key.endsWith("TwoStage"),
        },
      ];
    });
    const shown = contracts.map(
      ({ twoStage: _, ...contract }): ContractInfo => contract,
    );

    if (save) {
      yield* requireOnChainNetwork(network);
      yield* output.log(
        `Fetching on-chain data for ${contracts.length} contracts on ${network}...`,
      );
      const enriched = yield* Effect.forEach(contracts, ({ twoStage, ...c }) =>
        Effect.tap(enrichContract(c, twoStage), (info) =>
          output.log(
            `  ${info.name}... ${info.totalAda} ADA, ${info.utxos.length} UTxO(s)`,
          ),
        ),
      );
      const outputDir = resolve(releaseDir, network);
      const jsonPath = resolve(outputDir, "info.json");
      yield* writeReport(jsonPath, JSON.stringify(enriched, null, 2));
      yield* output.log(`\nJSON saved to ${jsonPath}`);
      const mdPath = resolve(outputDir, "address-report.md");
      yield* writeReport(mdPath, addressReport(network, enriched));
      yield* output.log(`Markdown report saved to ${mdPath}`);
      return enriched;
    }

    if (format === "json") {
      yield* output.log(JSON.stringify(shown, null, 2));
      return shown;
    }
    for (const [kind, group] of Map.groupBy(shown, (c) => c.component)) {
      yield* output.log(`\n=== ${kind.toUpperCase()} ===`);
      for (const line of formatTable(
        ["Name", "Script Hash", "Address"],
        group.map((c) => [
          c.name,
          c.scriptHash,
          `${c.address.slice(0, 16)}...${c.address.slice(-8)}`,
        ]),
      )) {
        yield* output.log(line);
      }
    }
    yield* output.log("\nNote: Use --format json for full addresses");
    return shown;
  });

// verify

export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

/** A titled group of checks, one section of the report. */
export interface CheckSection {
  readonly title: string;
  readonly results: readonly CheckResult[];
}

/** The six core upgradable tracks, deployed on every environment: a forever, a two-stage and a logic each. */
export const TRACKS = [
  "tech_auth",
  "council",
  "reserve",
  "ics",
  "federated_ops",
  "terms_and_conditions",
] as const;

/** The seventh upgradable track, cNIGHT minting; only some environments deploy it. */
export const CNIGHT_MINT_TRACK = "cnight_mint";

type Track = (typeof TRACKS)[number] | typeof CNIGHT_MINT_TRACK;

/** The tracks the record deploys: the core six, and cNIGHT minting when versions.json promotes its forever. */
export const tracksOf = ({ versions }: DeployedRecord): readonly Track[] =>
  versions.promoted.includes(`${CNIGHT_MINT_TRACK}_forever`)
    ? [...TRACKS, CNIGHT_MINT_TRACK]
    : TRACKS;

/** The six thresholds the governance transactions read. */
export const THRESHOLDS = [
  "main_gov_threshold",
  "staging_gov_threshold",
  "main_tech_auth_update_threshold",
  "main_council_update_threshold",
  "main_federated_ops_update_threshold",
  "terms_and_conditions_threshold",
] as const;

/** An NFT the chain must hold: its minting validator and asset name. */
interface Nft {
  readonly validator: string;
  readonly assetName: string;
  readonly label: string;
}

/** The NFTs the chain must hold for these tracks and the six thresholds; the cNIGHT minting deploy mints no forever NFT. */
const expectedNfts = (tracks: readonly Track[]): readonly Nft[] => [
  ...tracks.flatMap((track) => [
    ...(track === CNIGHT_MINT_TRACK
      ? []
      : [
          {
            validator: `${track}_forever`,
            assetName: "",
            label: `${track}_forever`,
          },
        ]),
    {
      validator: `${track}_two_stage_upgrade`,
      assetName: MAIN_TOKEN_HEX,
      label: `${track}_two_stage_upgrade main`,
    },
    {
      validator: `${track}_two_stage_upgrade`,
      assetName: STAGING_TOKEN_HEX,
      label: `${track}_two_stage_upgrade staging`,
    },
  ]),
  ...THRESHOLDS.map((threshold) => ({
    validator: threshold,
    assetName: "",
    label: threshold,
  })),
];

type RecordValidator = DeployedRecord["validators"][number];

/** The record's validator with this name. */
const named = (
  validators: readonly RecordValidator[],
  name: string,
): Option.Option<RecordValidator> =>
  Option.fromNullishOr(validators.find((v) => v.name === name));

const notInRecord = (name: string, missing: string): CheckResult => ({
  name,
  passed: false,
  details: `${missing} is not in the record`,
});

/** A UTxO reference as `txId#index`. */
const refOf = (utxo: TransactionUnspentOutput) =>
  `${utxo.input().transactionId()}#${utxo.input().index()}`;

/** The outputs at the script with this hash that hold one of its tokens named `assetName`. */
const holding = (
  outputs: readonly TransactionUnspentOutput[],
  scriptHash: string,
  assetName: string,
): readonly TransactionUnspentOutput[] => {
  const asset = AssetId(scriptHash + assetName);
  return outputs.filter(
    (utxo) =>
      utxo.output().address().getProps().paymentPart?.hash === scriptHash &&
      utxo.output().amount().multiasset()?.get(asset) === 1n,
  );
};

/** Check 1: each track's forever compiled code contains its two-stage hash. */
export const checkEmbedding = (record: DeployedRecord): CheckResult[] =>
  tracksOf(record).map((track) => {
    const { validators } = record;
    const name = `${track}_forever embeds ${track}_two_stage_upgrade`;
    const forever = named(validators, `${track}_forever`);
    const twoStage = named(validators, `${track}_two_stage_upgrade`);
    if (Option.isNone(forever)) return notInRecord(name, `${track}_forever`);
    if (Option.isNone(twoStage)) {
      return notInRecord(name, `${track}_two_stage_upgrade`);
    }
    const passed = forever.value.compiledCode.includes(twoStage.value.hash);
    return {
      name,
      passed,
      details: `${track}_forever ${passed ? "contains" : "does not contain"} ${twoStage.value.hash}`,
    };
  });

/** Check 2: each expected NFT sits in exactly one unspent output at its script. */
export const checkPresence = (
  record: DeployedRecord,
  outputs: readonly TransactionUnspentOutput[],
): CheckResult[] =>
  expectedNfts(tracksOf(record)).map((nft) =>
    Option.match(named(record.validators, nft.validator), {
      onNone: () => notInRecord(nft.label, nft.validator),
      onSome: ({ hash }) => {
        const held = holding(outputs, hash, nft.assetName);
        return {
          name: nft.label,
          passed: held.length === 1,
          details: `${held.length} unspent output(s) at the script hold ${hash}.${nft.assetName}${held.length > 0 ? `: ${held.map(refOf).join(", ")}` : ""}`,
        };
      },
    }),
  );

/** A mitigation field of an UpgradeState: empty, or the hash of a validator the record names. */
const mitigationCheck = (
  validators: readonly RecordValidator[],
  label: string,
  hash: string,
): { readonly passed: boolean; readonly detail: string } => {
  if (hash === "") return { passed: true, detail: `${label} is empty` };
  const known = validators.find((v) => v.hash === hash);
  return known
    ? {
        passed: true,
        detail: `${label} ${known.name} (${hash}) is in the record`,
      }
    : { passed: false, detail: `${label} ${hash} is not in the record` };
};

/** One UpgradeState check: the track's main or staging datum against the record. */
const upgradeStateCheck = (
  { validators, versions }: DeployedRecord,
  outputs: readonly TransactionUnspentOutput[],
  track: Track,
  stage: "main" | "staging",
): Effect.Effect<CheckResult> => {
  const name = `${track} ${stage}`;
  const authName = stage === "main" ? "main_gov_auth" : "staging_gov_auth";
  const twoStage = named(validators, `${track}_two_stage_upgrade`);
  const auth = named(validators, authName);
  if (Option.isNone(twoStage)) {
    return Effect.succeed(notInRecord(name, `${track}_two_stage_upgrade`));
  }
  if (Option.isNone(auth)) return Effect.succeed(notInRecord(name, authName));
  const held = holding(
    outputs,
    twoStage.value.hash,
    stage === "main" ? MAIN_TOKEN_HEX : STAGING_TOKEN_HEX,
  );
  if (held.length !== 1) {
    return Effect.succeed({
      name,
      passed: false,
      details: `${held.length} unspent outputs hold the ${stage} NFT`,
    });
  }
  return Effect.map(
    Effect.result(rawUpgradeStateAt(held[0])),
    Result.match({
      onFailure: (error) => ({
        name,
        passed: false,
        details: renderError(error),
      }),
      onSuccess: ([
        logicHash,
        mitigationLogicHash,
        authHash,
        mitigationAuthHash,
      ]): CheckResult => {
        const allowed =
          stage === "main"
            ? versions.promoted
            : [...versions.promoted, ...versions.staged];
        const logic = Option.map(
          Option.fromNullishOr(
            validators.find(
              (v) => v.hash === logicHash && isTrackLogic(track, v.name),
            ),
          ),
          (v) => v.name,
        );
        const logicOk = Option.exists(logic, (l) => allowed.includes(l));
        const authOk = authHash === auth.value.hash;
        const mitigations = [
          mitigationCheck(validators, "mitigation logic", mitigationLogicHash),
          mitigationCheck(validators, "mitigation auth", mitigationAuthHash),
        ];
        return {
          name,
          passed: logicOk && authOk && mitigations.every((m) => m.passed),
          details: [
            `UTxO ${refOf(held[0])}`,
            Option.match(logic, {
              onNone: () =>
                `logic ${logicHash} is no ${track}_logic or ${track}_logic_v<N> in the record`,
              onSome: (l) =>
                `logic ${l} (${logicHash}) ${logicOk ? "is" : "is not"} ${stage === "main" ? "promoted" : "promoted or staged"} in versions.json`,
            }),
            `auth ${authHash} ${authOk ? "is" : "is not"} ${authName} (${auth.value.hash})`,
            ...mitigations.map((m) => m.detail),
          ].join("\n"),
        };
      },
    }),
  );
};

/** Check 3: each track's main and staging UpgradeState. */
export const checkUpgradeStates = (
  record: DeployedRecord,
  outputs: readonly TransactionUnspentOutput[],
): Effect.Effect<CheckResult[]> =>
  Effect.forEach(
    tracksOf(record).flatMap((track) =>
      (["main", "staging"] as const).map((stage) => ({ track, stage })),
    ),
    ({ track, stage }) => upgradeStateCheck(record, outputs, track, stage),
  );

/** Every check of the record against the unspent outputs at its scripts. */
export const verifyChecks = (
  record: DeployedRecord,
  outputs: readonly TransactionUnspentOutput[],
): Effect.Effect<readonly CheckSection[]> =>
  Effect.map(checkUpgradeStates(record, outputs), (upgradeStates) => [
    {
      title: "Check 1: each forever embeds its two-stage hash",
      results: checkEmbedding(record),
    },
    {
      title: "Check 2: each NFT sits in one unspent output at its script",
      results: checkPresence(record, outputs),
    },
    {
      title:
        "Check 3: each UpgradeState names an allowed logic and its gov auth",
      results: upgradeStates,
    },
  ]);

/**
 * verify: check the environment's deployed record (plutus.json and
 * versions.json) against the chain's unspent outputs at the record's
 * scripts:
 *   1. each track's forever embeds its two-stage hash;
 *   2. each forever, two-stage main, two-stage staging and threshold NFT sits
 *      in exactly one unspent output at its script;
 *   3. each two-stage UpgradeState names the record's gov auth, a logic of
 *      its track that versions.json promoted (main), or promoted or staged
 *      (staging), and a mitigation logic and mitigation auth that are each
 *      empty or in the record.
 * The six core tracks are always checked; cNIGHT minting where versions.json
 * promotes its forever. Writes release/<env>/verification-report.md and
 * fails with VerificationFailed when any check fails.
 */
export const verifyProgram = (input: { readonly network: Environment }) =>
  Effect.gen(function* () {
    const { network } = input;
    const output = yield* Output;
    const provider = yield* Provider;
    const record = yield* (yield* ContractResolver).record;
    const { networkId } = environmentOf(network);
    const scripts = new Set(
      expectedNfts(tracksOf(record)).flatMap((nft) =>
        Option.toArray(named(record.validators, nft.validator)).map(
          (v) => v.hash,
        ),
      ),
    );
    const outputs = (yield* Effect.forEach(
      [...scripts],
      (hash) => provider.unspentOutputs(scriptAddress(networkId, hash)),
      { concurrency: 4 },
    )).flat();
    yield* output.log(
      `Verifying the ${network} record against ${outputs.length} unspent outputs at its scripts...`,
    );
    yield* output.log("");

    const sections = yield* verifyChecks(record, outputs);
    for (const { title, results } of sections) {
      yield* output.log(`${title}...`);
      for (const r of results) {
        yield* output.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`);
      }
      yield* output.log("");
    }

    const results = sections.flatMap((s) => s.results);
    const failed = results.filter((r) => !r.passed).length;
    const reportPath = resolve(`release/${network}`, "verification-report.md");
    yield* writeReport(
      reportPath,
      [
        "# Deployment Verification Report",
        "",
        `**Network:** ${network}`,
        `**Date:** ${new Date().toISOString()}`,
        `**Result:** ${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`,
        `**Summary:** ${results.length - failed} passed, ${failed} failed, ${results.length} total`,
        "",
        "---",
        "",
        ...sections.flatMap(({ title, results }) => [
          `## ${title}`,
          "",
          ...results.flatMap((r) => [
            `### [${r.passed ? "PASS" : "FAIL"}] ${r.name}`,
            "",
            "```",
            r.details,
            "```",
            "",
          ]),
        ]),
      ].join("\n"),
    );
    yield* output.log(`Report saved to ${reportPath}`);
    yield* output.log("");
    if (failed > 0) return yield* new VerificationFailed({ failed });
    yield* output.log("VERIFICATION PASSED: All checks passed.");
    return sections;
  });

// dust-participants

/** UTxOs holding a token under the dust policy; one per registered participant. */
export const dustUtxos = (
  utxos: readonly TransactionUnspentOutput[],
  policyId: string,
): TransactionUnspentOutput[] =>
  utxos.filter((utxo) =>
    [...(utxo.output().amount().multiasset()?.keys() ?? [])].some((assetId) =>
      assetId.startsWith(policyId),
    ),
  );

/** Count the UTxOs at the cnight_generates_dust address that hold a dust token. */
export const dustParticipantsProgram = (input: {
  readonly network: Environment;
  readonly format: Format;
}) =>
  Effect.gen(function* () {
    const { network, format } = input;
    yield* requireOnChainNetwork(network);
    const output = yield* Output;
    const instances = yield* (yield* ContractResolver).contracts("actsOn")
      .instances;
    const policyId = instances.cnightGeneratesDust.Script.hash();
    const { networkId } = environmentOf(network);
    const address = scriptAddress(networkId, policyId);
    const bech32 = address.toBech32();
    if (format !== "json") {
      yield* output.log(
        `\nQuerying dust participants for ${network} network...\n`,
      );
      yield* output.log(`  Policy ID: ${policyId}`);
      yield* output.log(`  Address:   ${bech32}\n`);
    }
    const utxos = yield* (yield* Provider).unspentOutputs(address);
    const participantCount = dustUtxos(utxos, policyId).length;
    if (format === "json") {
      yield* output.log(
        JSON.stringify(
          {
            network,
            policyId,
            address: bech32,
            totalUtxos: utxos.length,
            participantCount,
          },
          null,
          2,
        ),
      );
    } else {
      yield* output.log(`  Total UTxOs at address: ${utxos.length}`);
      yield* output.log(`  UTxOs with dust token:  ${participantCount}`);
      yield* output.log(
        `\n  Registered dust participants: ${participantCount}\n`,
      );
    }
    return {
      policyId,
      address: bech32,
      totalUtxos: utxos.length,
      participantCount,
    };
  });

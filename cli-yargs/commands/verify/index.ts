import type { Argv, CommandModule } from "yargs";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { HexBlob, PlutusData, PlutusDataKind } from "@blaze-cardano/core";
import type { GlobalOptions } from "../../lib/global-options";
import { getCardanoNetwork } from "../../lib/network-mapping";
import { getCurrentVersion } from "../../lib/versions";

// --- Types ---

interface PlutusValidator {
  title: string;
  hash: string;
  compiledCode: string;
}

interface PlutusJson {
  validators: PlutusValidator[];
}

interface DeploymentTx {
  type: string;
  description: string;
  cborHex: string;
  txHash: string;
  signed: boolean;
}

interface DeploymentTransactionsJson {
  network: string;
  timestamp: string;
  config: { utxoAmount: string };
  transactions: DeploymentTx[];
}

interface BlockfrostUtxoOutput {
  address: string;
  amount: { unit: string; quantity: string }[];
  output_index: number;
  inline_datum: string | null;
}

interface BlockfrostTxUtxos {
  hash: string;
  inputs: unknown[];
  outputs: BlockfrostUtxoOutput[];
}

interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
}

type VerifyOptions = GlobalOptions;

// --- Constants ---

const MAIN_TRACK_SET = [
  "tech_auth",
  "council",
  "reserve",
  "ics",
  "federated_ops",
  "terms_and_conditions",
] as const;

const TX_DESCRIPTION_TO_VALIDATORS: Record<string, string[]> = {
  "technical-authority-deployment": [
    "tech_auth_forever",
    "tech_auth_two_stage_upgrade",
    "tech_auth_logic",
  ],
  "tech-auth-update-threshold-deployment": ["main_tech_auth_update_threshold"],
  "council-deployment": [
    "council_forever",
    "council_two_stage_upgrade",
    "council_logic",
  ],
  "council-update-threshold-deployment": ["main_council_update_threshold"],
  "reserve-deployment": [
    "reserve_forever",
    "reserve_two_stage_upgrade",
    "reserve_logic",
  ],
  "ics-deployment": ["ics_forever", "ics_two_stage_upgrade", "ics_logic"],
  "main-gov-threshold-deployment": ["main_gov_threshold"],
  "staging-gov-threshold-deployment": ["staging_gov_threshold"],
  "federated-ops-deployment": [
    "federated_ops_forever",
    "federated_ops_two_stage_upgrade",
    "federated_ops_logic",
  ],
  "federated-ops-update-threshold-deployment": [
    "main_federated_ops_update_threshold",
  ],
  "terms-and-conditions-deployment": [
    "terms_and_conditions_forever",
    "terms_and_conditions_two_stage_upgrade",
    "terms_and_conditions_logic",
  ],
  "terms-and-conditions-threshold-deployment": [
    "terms_and_conditions_threshold",
  ],
};

const TX_DESCRIPTION_TO_OUTPUT_POLICY_VALIDATORS: Record<string, string[]> = {
  "technical-authority-deployment": [
    "tech_auth_forever",
    "tech_auth_two_stage_upgrade",
  ],
  "tech-auth-update-threshold-deployment": ["main_tech_auth_update_threshold"],
  "council-deployment": ["council_forever", "council_two_stage_upgrade"],
  "council-update-threshold-deployment": ["main_council_update_threshold"],
  "reserve-deployment": ["reserve_forever", "reserve_two_stage_upgrade"],
  "ics-deployment": ["ics_forever", "ics_two_stage_upgrade"],
  "main-gov-threshold-deployment": ["main_gov_threshold"],
  "staging-gov-threshold-deployment": ["staging_gov_threshold"],
  "federated-ops-deployment": [
    "federated_ops_forever",
    "federated_ops_two_stage_upgrade",
  ],
  "federated-ops-update-threshold-deployment": [
    "main_federated_ops_update_threshold",
  ],
  "terms-and-conditions-deployment": [
    "terms_and_conditions_forever",
    "terms_and_conditions_two_stage_upgrade",
  ],
  "terms-and-conditions-threshold-deployment": [
    "terms_and_conditions_threshold",
  ],
};

const TWO_STAGE_DEPLOYMENT_DESCRIPTIONS = [
  "technical-authority-deployment",
  "council-deployment",
  "reserve-deployment",
  "ics-deployment",
  "federated-ops-deployment",
  "terms-and-conditions-deployment",
];

const MAIN_ASSET_NAME_HEX = "6d61696e";
const STAGING_ASSET_NAME_HEX = "73746167696e67";

// --- Helpers ---

function findValidatorByName(
  validators: PlutusValidator[],
  name: string,
): PlutusValidator | undefined {
  return validators.find((v) => {
    const parts = v.title.split(".");
    return parts.length >= 2 && parts[1] === name;
  });
}

function findValidatorHash(
  validators: PlutusValidator[],
  name: string,
): string | undefined {
  return findValidatorByName(validators, name)?.hash;
}

async function blockfrostFetch(
  baseUrl: string,
  apiKey: string,
  path: string,
): Promise<unknown> {
  const resp = await fetch(`${baseUrl}${path}`, {
    headers: { project_id: apiKey },
  });
  if (!resp.ok) {
    throw new Error(
      `Blockfrost ${path} failed: ${resp.status} ${resp.statusText}`,
    );
  }
  return resp.json();
}

function sortedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function extractPolicyIds(outputs: BlockfrostUtxoOutput[]): string[] {
  const policyIds = new Set<string>();
  for (const output of outputs) {
    for (const amt of output.amount) {
      if (amt.unit !== "lovelace" && amt.unit.length >= 56) {
        policyIds.add(amt.unit.slice(0, 56));
      }
    }
  }
  return [...policyIds];
}

function parseUpgradeStateDatum(inlineDatumCbor: string): {
  logicHash: string;
  authHash: string;
} | null {
  try {
    const plutusData = PlutusData.fromCbor(HexBlob(inlineDatumCbor));
    const items =
      plutusData.asList() ?? plutusData.asConstrPlutusData()?.getData();
    if (!items || items.getLength() < 3) return null;

    const logicField = items.get(0);
    const authField = items.get(2);

    if (
      logicField.getKind() !== PlutusDataKind.Bytes ||
      authField.getKind() !== PlutusDataKind.Bytes
    ) {
      return null;
    }

    const logicHash = Buffer.from(logicField.asBoundedBytes()!).toString("hex");
    const authHash = Buffer.from(authField.asBoundedBytes()!).toString("hex");

    return { logicHash, authHash };
  } catch {
    return null;
  }
}

function getTwoStagePolicyId(
  validators: PlutusValidator[],
  mainTrackName: string,
): string | undefined {
  return findValidatorHash(validators, `${mainTrackName}_two_stage_upgrade`);
}

function getDescriptionTrackName(description: string): string | undefined {
  const descToTrack: Record<string, string> = {
    "technical-authority-deployment": "tech_auth",
    "council-deployment": "council",
    "reserve-deployment": "reserve",
    "ics-deployment": "ics",
    "federated-ops-deployment": "federated_ops",
    "terms-and-conditions-deployment": "terms_and_conditions",
  };
  return descToTrack[description];
}

// --- Check Implementations ---

function checkForeverEmbedding(validators: PlutusValidator[]): CheckResult[] {
  const results: CheckResult[] = [];

  for (const track of MAIN_TRACK_SET) {
    const foreverName = `${track}_forever`;
    const twoStageName = `${track}_two_stage_upgrade`;

    const forever = findValidatorByName(validators, foreverName);
    const twoStage = findValidatorByName(validators, twoStageName);

    if (!forever) {
      results.push({
        name: `Embedding: ${foreverName}`,
        passed: false,
        details: `Forever validator '${foreverName}' not found in plutus.json`,
      });
      continue;
    }
    if (!twoStage) {
      results.push({
        name: `Embedding: ${foreverName}`,
        passed: false,
        details: `Two-stage validator '${twoStageName}' not found in plutus.json`,
      });
      continue;
    }

    const embedded = forever.compiledCode.includes(twoStage.hash);
    results.push({
      name: `Embedding: ${foreverName} contains ${twoStageName} hash`,
      passed: embedded,
      details: embedded
        ? `PASS: ${foreverName} compiledCode contains two-stage hash ${twoStage.hash}`
        : `FAIL: ${foreverName} compiledCode does NOT contain two-stage hash ${twoStage.hash}`,
    });
  }

  return results;
}

async function checkOnChainScriptHashes(
  validators: PlutusValidator[],
  deploymentTxs: DeploymentTx[],
  baseUrl: string,
  apiKey: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const expectedDescriptions = Object.keys(TX_DESCRIPTION_TO_VALIDATORS);

  const actualDescriptions = deploymentTxs.map((tx) => tx.description);
  const missingDescriptions = expectedDescriptions.filter(
    (d) => !actualDescriptions.includes(d),
  );
  const unexpectedDescriptions = actualDescriptions.filter(
    (d) => !expectedDescriptions.includes(d),
  );

  if (missingDescriptions.length > 0 || unexpectedDescriptions.length > 0) {
    results.push({
      name: "Deployment transactions: expected descriptions",
      passed: false,
      details: [
        `Expected exactly 12 deployment transactions.`,
        missingDescriptions.length > 0
          ? `Missing: ${missingDescriptions.join(", ")}`
          : "",
        unexpectedDescriptions.length > 0
          ? `Unexpected: ${unexpectedDescriptions.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } else {
    results.push({
      name: "Deployment transactions: expected descriptions",
      passed: true,
      details: `PASS: All 12 expected deployment descriptions present, no unexpected ones.`,
    });
  }

  for (const tx of deploymentTxs) {
    const expectedPolicyValidatorNames =
      TX_DESCRIPTION_TO_OUTPUT_POLICY_VALIDATORS[tx.description];
    if (!expectedPolicyValidatorNames) continue;

    const expectedPolicyHashes = expectedPolicyValidatorNames
      .map((name) => findValidatorHash(validators, name))
      .filter((h): h is string => h !== undefined);

    if (expectedPolicyHashes.length !== expectedPolicyValidatorNames.length) {
      const missing = expectedPolicyValidatorNames.filter(
        (name) => !findValidatorHash(validators, name),
      );
      results.push({
        name: `On-chain: ${tx.description}`,
        passed: false,
        details: `Could not find hashes for validators: ${missing.join(", ")}`,
      });
      continue;
    }

    let utxos: BlockfrostTxUtxos;
    try {
      utxos = (await blockfrostFetch(
        baseUrl,
        apiKey,
        `/txs/${tx.txHash}/utxos`,
      )) as BlockfrostTxUtxos;
    } catch (err) {
      results.push({
        name: `On-chain: ${tx.description}`,
        passed: false,
        details: `Blockfrost query failed for ${tx.txHash}: ${err}`,
      });
      continue;
    }

    const onChainPolicyIds = extractPolicyIds(utxos.outputs);
    const passed = sortedEqual(expectedPolicyHashes, onChainPolicyIds);

    const allExpectedNames = TX_DESCRIPTION_TO_VALIDATORS[tx.description] || [];
    const logicNames = allExpectedNames.filter(
      (n) => !expectedPolicyValidatorNames.includes(n),
    );
    const logicNote =
      logicNames.length > 0
        ? `\nLogic script(s) verified via UpgradeState datum: [${logicNames.map((n) => `${n}=${findValidatorHash(validators, n)}`).join(", ")}]`
        : "";

    results.push({
      name: `On-chain: ${tx.description}`,
      passed,
      details: [
        `Tx: ${tx.txHash}`,
        `Expected policy IDs (from NFTs): [${expectedPolicyHashes.sort().join(", ")}]`,
        `Actual on-chain policy IDs:      [${onChainPolicyIds.sort().join(", ")}]`,
        passed ? "PASS" : "FAIL: Mismatch",
        logicNote,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  return results;
}

async function checkUpgradeStateDatums(
  validators: PlutusValidator[],
  deploymentTxs: DeploymentTx[],
  baseUrl: string,
  apiKey: string,
  mode: "main" | "staging",
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const govAuthName = mode === "main" ? "main_gov_auth" : "staging_gov_auth";
  const expectedAuthHash = findValidatorHash(validators, govAuthName);
  if (!expectedAuthHash) {
    results.push({
      name: `UpgradeState (${mode}): gov auth lookup`,
      passed: false,
      details: `Could not find hash for ${govAuthName} in plutus.json`,
    });
    return results;
  }

  const targetAssetNameHex =
    mode === "main" ? MAIN_ASSET_NAME_HEX : STAGING_ASSET_NAME_HEX;

  for (const description of TWO_STAGE_DEPLOYMENT_DESCRIPTIONS) {
    const tx = deploymentTxs.find((t) => t.description === description);
    if (!tx) {
      results.push({
        name: `UpgradeState (${mode}): ${description}`,
        passed: false,
        details: `Deployment tx '${description}' not found`,
      });
      continue;
    }

    const trackName = getDescriptionTrackName(description);
    if (!trackName) continue;

    const expectedLogicHash = findValidatorHash(
      validators,
      `${trackName}_logic`,
    );
    if (!expectedLogicHash) {
      results.push({
        name: `UpgradeState (${mode}): ${description}`,
        passed: false,
        details: `Could not find logic hash for ${trackName}_logic`,
      });
      continue;
    }

    const twoStagePolicyId = getTwoStagePolicyId(validators, trackName);
    if (!twoStagePolicyId) {
      results.push({
        name: `UpgradeState (${mode}): ${description}`,
        passed: false,
        details: `Could not find two-stage policy ID for ${trackName}`,
      });
      continue;
    }

    let utxos: BlockfrostTxUtxos;
    try {
      utxos = (await blockfrostFetch(
        baseUrl,
        apiKey,
        `/txs/${tx.txHash}/utxos`,
      )) as BlockfrostTxUtxos;
    } catch (err) {
      results.push({
        name: `UpgradeState (${mode}): ${description}`,
        passed: false,
        details: `Blockfrost query failed for ${tx.txHash}: ${err}`,
      });
      continue;
    }

    const targetUnit = `${twoStagePolicyId}${targetAssetNameHex}`;
    const targetOutput = utxos.outputs.find((o) =>
      o.amount.some((a) => a.unit === targetUnit),
    );

    if (!targetOutput) {
      results.push({
        name: `UpgradeState (${mode}): ${description}`,
        passed: false,
        details: `No output found with ${mode} NFT (${targetUnit}) in tx ${tx.txHash}`,
      });
      continue;
    }

    if (!targetOutput.inline_datum) {
      results.push({
        name: `UpgradeState (${mode}): ${description}`,
        passed: false,
        details: `Output with ${mode} NFT has no inline datum in tx ${tx.txHash}`,
      });
      continue;
    }

    const parsed = parseUpgradeStateDatum(targetOutput.inline_datum);
    if (!parsed) {
      results.push({
        name: `UpgradeState (${mode}): ${description}`,
        passed: false,
        details: `Could not parse UpgradeState datum from ${mode} NFT output in tx ${tx.txHash}. Raw CBOR: ${targetOutput.inline_datum.slice(0, 80)}...`,
      });
      continue;
    }

    const logicOk = parsed.logicHash === expectedLogicHash;
    const authOk = parsed.authHash === expectedAuthHash;
    const passed = logicOk && authOk;

    results.push({
      name: `UpgradeState (${mode}): ${description}`,
      passed,
      details: [
        `Tx: ${tx.txHash}`,
        `Logic hash - expected: ${expectedLogicHash}, actual: ${parsed.logicHash} ${logicOk ? "PASS" : "FAIL"}`,
        `Auth hash (${govAuthName}) - expected: ${expectedAuthHash}, actual: ${parsed.authHash} ${authOk ? "PASS" : "FAIL"}`,
      ].join("\n"),
    });
  }

  return results;
}

// --- Report Generation ---

function generateReport(network: string, allResults: CheckResult[]): string {
  const totalPassed = allResults.filter((r) => r.passed).length;
  const totalFailed = allResults.filter((r) => !r.passed).length;
  const allPassed = totalFailed === 0;

  const lines: string[] = [
    `# Deployment Verification Report`,
    ``,
    `**Network:** ${network}`,
    `**Date:** ${new Date().toISOString()}`,
    `**Result:** ${allPassed ? "ALL CHECKS PASSED" : `${totalFailed} CHECK(S) FAILED`}`,
    `**Summary:** ${totalPassed} passed, ${totalFailed} failed, ${allResults.length} total`,
    ``,
    `---`,
    ``,
  ];

  const embeddingResults = allResults.filter((r) =>
    r.name.startsWith("Embedding:"),
  );
  const onChainResults = allResults.filter(
    (r) =>
      r.name.startsWith("On-chain:") ||
      r.name.startsWith("Deployment transactions:"),
  );
  const mainDatumResults = allResults.filter((r) =>
    r.name.startsWith("UpgradeState (main):"),
  );
  const stagingDatumResults = allResults.filter((r) =>
    r.name.startsWith("UpgradeState (staging):"),
  );

  function renderSection(title: string, results: CheckResult[]): void {
    if (results.length === 0) return;
    lines.push(`## ${title}`);
    lines.push(``);
    for (const r of results) {
      const icon = r.passed ? "[PASS]" : "[FAIL]";
      lines.push(`### ${icon} ${r.name}`);
      lines.push(``);
      lines.push("```");
      lines.push(r.details);
      lines.push("```");
      lines.push(``);
    }
  }

  renderSection(
    "Check 1: Forever Script -> Two-Stage Embedding",
    embeddingResults,
  );
  renderSection("Check 2: On-Chain Script Hash Verification", onChainResults);
  renderSection(
    "Check 3: UpgradeState Datum Verification (Main Outputs)",
    mainDatumResults,
  );
  renderSection(
    "Check 4: UpgradeState Datum Verification (Staging Outputs)",
    stagingDatumResults,
  );

  return lines.join("\n");
}

// --- Command ---

export const command = "verify";
export const describe = "Verify on-chain deployment against local artifacts";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs;
}

export async function handler(argv: VerifyOptions) {
  const { network } = argv;

  const cardanoNetwork = getCardanoNetwork(network);
  if (!cardanoNetwork) {
    throw new Error(
      `Cannot verify environment '${network}': no real Cardano network mapped. ` +
        `Use a real network like preview, preprod, or mainnet.`,
    );
  }

  const apiKeyVar = `BLOCKFROST_${cardanoNetwork.toUpperCase()}_API_KEY`;
  const apiKey = process.env[apiKeyVar];
  if (!apiKey) {
    throw new Error(
      `Environment variable ${apiKeyVar} is required but not set.`,
    );
  }

  const networkNameMap: Record<string, string> = {
    preview: "cardano-preview",
    preprod: "cardano-preprod",
    mainnet: "cardano-mainnet",
  };
  const baseUrl = `https://${networkNameMap[cardanoNetwork]}.blockfrost.io/api/v0`;

  // Load plutus.json
  const currentVersion = getCurrentVersion(network);
  if (!currentVersion) {
    throw new Error(
      `No current version set for environment '${network}'. ` +
        `Expected versions.json in deployed-scripts/${network}/ with a 'current' field.`,
    );
  }
  const plutusPath = resolve(
    `deployed-scripts/${network}/versions/${currentVersion}/plutus.json`,
  );
  let plutusJson: PlutusJson;
  try {
    plutusJson = JSON.parse(readFileSync(plutusPath, "utf8"));
  } catch {
    throw new Error(`Cannot read plutus.json at ${plutusPath}`);
  }

  // Load deployment transactions
  const deployTxPath = resolve(
    `deployments/${network}/deployment-transactions.json`,
  );
  let deploymentData: DeploymentTransactionsJson;
  try {
    deploymentData = JSON.parse(readFileSync(deployTxPath, "utf8"));
  } catch {
    throw new Error(
      `Cannot read deployment-transactions.json at ${deployTxPath}`,
    );
  }

  const validators = plutusJson.validators;
  const deploymentTxs = deploymentData.transactions;

  console.log(
    `Verifying ${network} deployment (${validators.length} validators, ${deploymentTxs.length} transactions)...`,
  );
  console.log();

  // Check 1: Forever -> Two-Stage Embedding
  console.log("Check 1: Forever script -> Two-stage embedding...");
  const embeddingResults = checkForeverEmbedding(validators);
  for (const r of embeddingResults) {
    console.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`);
  }
  console.log();

  // Check 2: On-chain script hash verification
  console.log("Check 2: On-chain script hash verification...");
  const onChainResults = await checkOnChainScriptHashes(
    validators,
    deploymentTxs,
    baseUrl,
    apiKey,
  );
  for (const r of onChainResults) {
    console.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`);
  }
  console.log();

  // Check 3: UpgradeState datum verification (main)
  console.log("Check 3: UpgradeState datum verification (main outputs)...");
  const mainDatumResults = await checkUpgradeStateDatums(
    validators,
    deploymentTxs,
    baseUrl,
    apiKey,
    "main",
  );
  for (const r of mainDatumResults) {
    console.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`);
  }
  console.log();

  // Check 4: UpgradeState datum verification (staging)
  console.log("Check 4: UpgradeState datum verification (staging outputs)...");
  const stagingDatumResults = await checkUpgradeStateDatums(
    validators,
    deploymentTxs,
    baseUrl,
    apiKey,
    "staging",
  );
  for (const r of stagingDatumResults) {
    console.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`);
  }
  console.log();

  // Generate report
  const allResults = [
    ...embeddingResults,
    ...onChainResults,
    ...mainDatumResults,
    ...stagingDatumResults,
  ];

  const report = generateReport(network, allResults);

  // Write report
  const reportDir = resolve(`release/${network}`);
  mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, "verification-report.md");
  writeFileSync(reportPath, report, "utf8");
  console.log(`Report saved to ${reportPath}`);

  // Summary
  const totalFailed = allResults.filter((r) => !r.passed).length;
  if (totalFailed > 0) {
    console.log();
    console.log(`VERIFICATION FAILED: ${totalFailed} check(s) failed.`);
    process.exit(1);
  } else {
    console.log();
    console.log("VERIFICATION PASSED: All checks passed.");
  }
}

const commandModule: CommandModule<GlobalOptions, VerifyOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

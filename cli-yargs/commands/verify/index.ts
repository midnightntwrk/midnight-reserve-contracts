import type { Argv, CommandModule } from "yargs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import type { GlobalOptions } from "../../lib/global-options";
import { getCardanoNetwork } from "../../lib/network-mapping";
import {
  blockfrostFetch,
  parseUpgradeStateDatum,
  getBlockfrostBaseUrl,
} from "../../lib/blockfrost";

// --- Types ---

interface PlutusValidator {
  title: string;
  hash: string;
  compiledCode: string;
}

interface DeploymentTx {
  type: string;
  description: string;
  cborHex: string;
  txHash: string;
  signed: boolean;
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

export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function requireArrayField(
  value: unknown,
  fieldName: string,
  filePath: string,
): unknown[] {
  if (!isObjectLike(value) || Array.isArray(value)) {
    throw new Error(
      `Invalid JSON schema in ${filePath}: expected top-level JSON object`,
    );
  }
  const fieldValue = value[fieldName];
  if (!Array.isArray(fieldValue)) {
    throw new Error(
      `Invalid JSON schema in ${filePath}: expected '${fieldName}' to be an array`,
    );
  }
  return fieldValue;
}

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

function checkCnightForeverEmbedding(
  validators: PlutusValidator[],
): CheckResult[] {
  const forever = findValidatorByName(validators, "cnight_mint_forever");
  const twoStage = findValidatorByName(
    validators,
    "cnight_mint_two_stage_upgrade",
  );

  if (!forever) {
    return [
      {
        name: "cNIGHT Embedding: cnight_mint_forever",
        passed: false,
        details: "cnight_mint_forever not found in plutus.json",
      },
    ];
  }
  if (!twoStage) {
    return [
      {
        name: "cNIGHT Embedding: cnight_mint_forever",
        passed: false,
        details: "cnight_mint_two_stage_upgrade not found in plutus.json",
      },
    ];
  }

  const embedded = forever.compiledCode.includes(twoStage.hash);
  return [
    {
      name: `cNIGHT Embedding: cnight_mint_forever contains cnight_mint_two_stage_upgrade hash`,
      passed: embedded,
      details: embedded
        ? `PASS: cnight_mint_forever compiledCode contains two-stage hash ${twoStage.hash}`
        : `FAIL: cnight_mint_forever compiledCode does NOT contain two-stage hash ${twoStage.hash}`,
    },
  ];
}

async function checkCnightOnChainScriptHashes(
  validators: PlutusValidator[],
  cnightDeploymentTxs: DeploymentTx[],
  baseUrl: string,
  apiKey: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const tx = cnightDeploymentTxs.find(
    (t) => t.description === "cnight-minting-deployment",
  );
  if (!tx) {
    results.push({
      name: "cNIGHT On-chain: cnight-minting-deployment",
      passed: false,
      details: "cNIGHT minting deployment tx not found in transactions array",
    });
    return results;
  }

  const twoStageHash = findValidatorHash(
    validators,
    "cnight_mint_two_stage_upgrade",
  );
  if (!twoStageHash) {
    results.push({
      name: "cNIGHT On-chain: cnight-minting-deployment",
      passed: false,
      details: "cnight_mint_two_stage_upgrade not found in plutus.json",
    });
    return results;
  }

  let utxos: BlockfrostTxUtxos;
  try {
    const utxosResult = await blockfrostFetch(
      baseUrl,
      apiKey,
      `/txs/${tx.txHash}/utxos`,
    );
    if (utxosResult === null) {
      results.push({
        name: "cNIGHT On-chain: cnight-minting-deployment",
        passed: false,
        details: `Transaction not found: ${tx.txHash}`,
      });
      return results;
    }
    utxos = utxosResult as BlockfrostTxUtxos;
  } catch (err) {
    results.push({
      name: "cNIGHT On-chain: cnight-minting-deployment",
      passed: false,
      details: `Blockfrost query failed for ${tx.txHash}: ${err}`,
    });
    return results;
  }

  const onChainPolicyIds = extractPolicyIds(utxos.outputs);
  const hasTwoStagePolicy = onChainPolicyIds.includes(twoStageHash);

  results.push({
    name: "cNIGHT On-chain: cnight-minting-deployment",
    passed: hasTwoStagePolicy,
    details: [
      `Tx: ${tx.txHash}`,
      `Expected cnight_mint_two_stage policy: ${twoStageHash}`,
      `On-chain policy IDs: [${onChainPolicyIds.sort().join(", ")}]`,
      hasTwoStagePolicy
        ? "PASS"
        : "FAIL: Two-stage policy not found in outputs",
    ].join("\n"),
  });

  return results;
}

async function checkCnightUpgradeStateDatum(
  validators: PlutusValidator[],
  cnightDeploymentTxs: DeploymentTx[],
  baseUrl: string,
  apiKey: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const tx = cnightDeploymentTxs.find(
    (t) => t.description === "cnight-minting-deployment",
  );
  if (!tx) {
    results.push({
      name: "cNIGHT UpgradeState (main): cnight-minting-deployment",
      passed: false,
      details: "cNIGHT minting deployment tx not found",
    });
    return results;
  }

  const expectedLogicHash = findValidatorHash(validators, "cnight_mint_logic");
  const expectedAuthHash = findValidatorHash(validators, "main_gov_auth");
  const twoStagePolicyId = findValidatorHash(
    validators,
    "cnight_mint_two_stage_upgrade",
  );

  if (!expectedLogicHash || !expectedAuthHash || !twoStagePolicyId) {
    results.push({
      name: "cNIGHT UpgradeState (main): cnight-minting-deployment",
      passed: false,
      details: [
        "Missing required validator hashes:",
        !expectedLogicHash ? "  - cnight_mint_logic" : "",
        !expectedAuthHash ? "  - main_gov_auth" : "",
        !twoStagePolicyId ? "  - cnight_mint_two_stage_upgrade" : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return results;
  }

  let utxos: BlockfrostTxUtxos;
  try {
    const utxosResult = await blockfrostFetch(
      baseUrl,
      apiKey,
      `/txs/${tx.txHash}/utxos`,
    );
    if (utxosResult === null) {
      results.push({
        name: "cNIGHT UpgradeState (main): cnight-minting-deployment",
        passed: false,
        details: `Transaction not found: ${tx.txHash}`,
      });
      return results;
    }
    utxos = utxosResult as BlockfrostTxUtxos;
  } catch (err) {
    results.push({
      name: "cNIGHT UpgradeState (main): cnight-minting-deployment",
      passed: false,
      details: `Blockfrost query failed for ${tx.txHash}: ${err}`,
    });
    return results;
  }

  const targetUnit = `${twoStagePolicyId}${MAIN_ASSET_NAME_HEX}`;
  const targetOutput = utxos.outputs.find((o) =>
    o.amount.some((a) => a.unit === targetUnit),
  );

  if (!targetOutput) {
    results.push({
      name: "cNIGHT UpgradeState (main): cnight-minting-deployment",
      passed: false,
      details: `No output found with main NFT (${targetUnit}) in tx ${tx.txHash}`,
    });
    return results;
  }

  if (!targetOutput.inline_datum) {
    results.push({
      name: "cNIGHT UpgradeState (main): cnight-minting-deployment",
      passed: false,
      details: `Output with main NFT has no inline datum in tx ${tx.txHash}`,
    });
    return results;
  }

  const parsed = parseUpgradeStateDatum(targetOutput.inline_datum);
  if (!parsed) {
    results.push({
      name: "cNIGHT UpgradeState (main): cnight-minting-deployment",
      passed: false,
      details: `Could not parse UpgradeState datum. Raw CBOR: ${targetOutput.inline_datum.slice(0, 80)}...`,
    });
    return results;
  }

  const logicOk = parsed.logicHash === expectedLogicHash;
  const authOk = parsed.authHash === expectedAuthHash;

  results.push({
    name: "cNIGHT UpgradeState (main): cnight-minting-deployment",
    passed: logicOk && authOk,
    details: [
      `Tx: ${tx.txHash}`,
      `Logic hash - expected: ${expectedLogicHash}, actual: ${parsed.logicHash} ${logicOk ? "PASS" : "FAIL"}`,
      `Auth hash (main_gov_auth) - expected: ${expectedAuthHash}, actual: ${parsed.authHash} ${authOk ? "PASS" : "FAIL"}`,
    ].join("\n"),
  });

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
      const utxosResult = await blockfrostFetch(
        baseUrl,
        apiKey,
        `/txs/${tx.txHash}/utxos`,
      );
      if (utxosResult === null) {
        results.push({
          name: `On-chain: ${tx.description}`,
          passed: false,
          details: `Transaction not found: ${tx.txHash}`,
        });
        continue;
      }
      utxos = utxosResult as BlockfrostTxUtxos;
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
      const utxosResult = await blockfrostFetch(
        baseUrl,
        apiKey,
        `/txs/${tx.txHash}/utxos`,
      );
      if (utxosResult === null) {
        results.push({
          name: `UpgradeState (${mode}): ${description}`,
          passed: false,
          details: `Transaction not found: ${tx.txHash}`,
        });
        continue;
      }
      utxos = utxosResult as BlockfrostTxUtxos;
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
  const cnightEmbeddingResults = allResults.filter((r) =>
    r.name.startsWith("cNIGHT Embedding:"),
  );
  const cnightOnChainResults = allResults.filter((r) =>
    r.name.startsWith("cNIGHT On-chain:"),
  );
  const cnightDatumResults = allResults.filter((r) =>
    r.name.startsWith("cNIGHT UpgradeState"),
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
  renderSection(
    "Check 5: cNIGHT Forever -> Two-Stage Embedding",
    cnightEmbeddingResults,
  );
  renderSection(
    "Check 6: cNIGHT On-Chain Script Hash Verification",
    cnightOnChainResults,
  );
  renderSection(
    "Check 7: cNIGHT UpgradeState Datum Verification (Main)",
    cnightDatumResults,
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

  const baseUrl = getBlockfrostBaseUrl(cardanoNetwork);

  // Load plutus.json
  const plutusPath = resolve(`deployed-scripts/${network}/plutus.json`);
  let plutusJson: unknown;
  try {
    plutusJson = JSON.parse(readFileSync(plutusPath, "utf8"));
  } catch {
    throw new Error(`Cannot read plutus.json at ${plutusPath}`);
  }

  // Load deployment transactions
  const deployTxPath = resolve(
    `deployments/${network}/deployment-transactions.json`,
  );
  let deploymentData: unknown;
  try {
    deploymentData = JSON.parse(readFileSync(deployTxPath, "utf8"));
  } catch {
    throw new Error(
      `Cannot read deployment-transactions.json at ${deployTxPath}`,
    );
  }

  const validators = requireArrayField(
    plutusJson,
    "validators",
    plutusPath,
  ) as PlutusValidator[];
  const deploymentTxs = requireArrayField(
    deploymentData,
    "transactions",
    deployTxPath,
  ) as DeploymentTx[];

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

  // cNIGHT minting checks
  let cnightEmbeddingResults: CheckResult[] = [];
  let cnightOnChainResults: CheckResult[] = [];
  let cnightDatumResults: CheckResult[] = [];

  const cnightDeployTxPath = resolve(
    `deployments/${network}/cnight-minting-deployment.json`,
  );

  if (!existsSync(cnightDeployTxPath)) {
    console.log(
      "Skipping cNIGHT minting checks (no cnight-minting-deployment.json)",
    );
    console.log();
  } else {
    let cnightDeploymentData: unknown;
    try {
      cnightDeploymentData = JSON.parse(
        readFileSync(cnightDeployTxPath, "utf8"),
      );
    } catch {
      console.warn(
        `Warning: Cannot parse ${cnightDeployTxPath} — skipping cNIGHT on-chain checks`,
      );
    }

    if (cnightDeploymentData) {
      const cnightDeploymentTxs = requireArrayField(
        cnightDeploymentData,
        "transactions",
        cnightDeployTxPath,
      ) as DeploymentTx[];

      // Check 5: cNIGHT Forever -> Two-Stage Embedding
      console.log("Check 5: cNIGHT forever script -> two-stage embedding...");
      cnightEmbeddingResults = checkCnightForeverEmbedding(validators);
      for (const r of cnightEmbeddingResults) {
        console.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`);
      }
      console.log();

      // Check 6: cNIGHT on-chain script hash verification
      console.log("Check 6: cNIGHT on-chain script hash verification...");
      cnightOnChainResults = await checkCnightOnChainScriptHashes(
        validators,
        cnightDeploymentTxs,
        baseUrl,
        apiKey,
      );
      for (const r of cnightOnChainResults) {
        console.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`);
      }
      console.log();

      // Check 7: cNIGHT UpgradeState datum verification (main only)
      console.log("Check 7: cNIGHT UpgradeState datum verification (main)...");
      cnightDatumResults = await checkCnightUpgradeStateDatum(
        validators,
        cnightDeploymentTxs,
        baseUrl,
        apiKey,
      );
      for (const r of cnightDatumResults) {
        console.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`);
      }
      console.log();
    }
  }

  // Generate report
  const allResults = [
    ...embeddingResults,
    ...onChainResults,
    ...mainDatumResults,
    ...stagingDatumResults,
    ...cnightEmbeddingResults,
    ...cnightOnChainResults,
    ...cnightDatumResults,
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

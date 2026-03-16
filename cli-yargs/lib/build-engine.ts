import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  statSync,
  copyFileSync,
  renameSync,
} from "fs";
import { resolve } from "path";
import * as toml from "toml";
import { getDeployedScriptsPath } from "./versions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildOptions {
  network: string;
  traceLevel?: "silent" | "verbose" | "compact";
  fromDeployed?: boolean;
  projectRoot?: string;
}

export interface BuildResult {
  blueprintPath: string;
  network: string;
  fromDeployed: boolean;
}

interface ValidatorMapping {
  readonly title: string;
  readonly tomlKey: string;
}

interface PlutusBlueprint {
  preamble: Record<string, unknown>;
  validators: Array<{
    title: string;
    hash: string;
    compiledCode: string;
  }>;
}

interface LogicDependency {
  readonly logicValidator: string;
  readonly dependencyValidator: string;
}

// ---------------------------------------------------------------------------
// Validator Mappings (as const for type safety)
// ---------------------------------------------------------------------------

const TWO_STAGE_CORE = [
  {
    title: "reserve.reserve_two_stage_upgrade.else",
    tomlKey: "reserve_two_stage_hash",
  },
  {
    title: "permissioned.council_two_stage_upgrade.else",
    tomlKey: "council_two_stage_hash",
  },
  {
    title: "illiquid_circulation_supply.ics_two_stage_upgrade.else",
    tomlKey: "ics_two_stage_hash",
  },
  {
    title: "permissioned.tech_auth_two_stage_upgrade.else",
    tomlKey: "technical_authority_two_stage_hash",
  },
  {
    title: "permissioned.federated_ops_two_stage_upgrade.else",
    tomlKey: "federated_operators_two_stage_hash",
  },
  {
    title: "terms_and_conditions.terms_and_conditions_two_stage_upgrade.else",
    tomlKey: "terms_and_conditions_two_stage_hash",
  },
] as const satisfies readonly ValidatorMapping[];

const TWO_STAGE_EXTRA = [
  {
    title: "cnight_minting.cnight_mint_two_stage_upgrade.else",
    tomlKey: "cnight_minting_two_stage_hash",
  },
] as const satisfies readonly ValidatorMapping[];

const FOREVER_CORE = [
  { title: "reserve.reserve_forever.else", tomlKey: "reserve_forever_hash" },
  {
    title: "permissioned.council_forever.else",
    tomlKey: "council_forever_hash",
  },
  {
    title: "illiquid_circulation_supply.ics_forever.else",
    tomlKey: "ics_forever_hash",
  },
  {
    title: "permissioned.tech_auth_forever.else",
    tomlKey: "technical_authority_forever_hash",
  },
  {
    title: "permissioned.federated_ops_forever.else",
    tomlKey: "federated_operators_forever_hash",
  },
  {
    title: "terms_and_conditions.terms_and_conditions_forever.else",
    tomlKey: "terms_and_conditions_forever_hash",
  },
] as const satisfies readonly ValidatorMapping[];

const FOREVER_EXTRA = [
  {
    title: "cnight_minting.cnight_mint_forever.else",
    tomlKey: "cnight_minting_forever_hash",
  },
] as const satisfies readonly ValidatorMapping[];

const THRESHOLDS = [
  {
    title: "thresholds.main_gov_threshold.else",
    tomlKey: "main_gov_threshold_hash",
  },
  {
    title: "thresholds.staging_gov_threshold.else",
    tomlKey: "staging_gov_threshold_hash",
  },
  {
    title: "thresholds.main_council_update_threshold.else",
    tomlKey: "main_council_update_threshold_hash",
  },
  {
    title: "thresholds.main_tech_auth_update_threshold.else",
    tomlKey: "main_tech_auth_update_threshold_hash",
  },
  {
    title: "thresholds.main_federated_ops_update_threshold.else",
    tomlKey: "main_federated_ops_update_threshold_hash",
  },
  {
    title: "thresholds.beefy_signer_threshold.else",
    tomlKey: "bridge_signer_threshold_hash",
  },
  {
    title: "thresholds.terms_and_conditions_threshold.else",
    tomlKey: "terms_and_conditions_threshold_hash",
  },
] as const satisfies readonly ValidatorMapping[];

/** Validators grouped by compilation phase. */
export const VALIDATORS = {
  twoStageCore: TWO_STAGE_CORE,
  twoStageExtra: TWO_STAGE_EXTRA,
  twoStage: [...TWO_STAGE_CORE, ...TWO_STAGE_EXTRA],
  foreverCore: FOREVER_CORE,
  foreverExtra: FOREVER_EXTRA,
  forever: [...FOREVER_CORE, ...FOREVER_EXTRA],
  thresholds: THRESHOLDS,
} as const;

/** Logic validators that must embed specific threshold hashes. */
const LOGIC_DEPENDENCIES: readonly LogicDependency[] = [
  {
    logicValidator: "permissioned.council_logic.else",
    dependencyValidator: "thresholds.main_council_update_threshold.else",
  },
  {
    logicValidator: "permissioned.tech_auth_logic.else",
    dependencyValidator: "thresholds.main_tech_auth_update_threshold.else",
  },
  {
    logicValidator: "permissioned.federated_ops_logic.else",
    dependencyValidator: "thresholds.main_federated_ops_update_threshold.else",
  },
  {
    logicValidator: "gov_auth.main_gov_auth.else",
    dependencyValidator: "thresholds.main_gov_threshold.else",
  },
] as const;

/** Threshold config entry that must match the blueprint hash. */
const THRESHOLD_CONFIG_CHECKS = [
  {
    displayName: "committee_signer_threshold",
    tomlKey: "bridge_signer_threshold_hash",
    validatorTitle: "thresholds.beefy_signer_threshold.else",
  },
] as const;

const MAX_VERIFY_ATTEMPTS = 2;
const TOML_FILE = "aiken.toml";
const LOCK_FILE = "build/aiken-compile.lock";

// ---------------------------------------------------------------------------
// TOML Read/Write Engine
// ---------------------------------------------------------------------------

/**
 * Reads aiken.toml and returns the parsed config for a given network.
 */
function readToml(projectRoot: string): Record<string, unknown> {
  const tomlPath = resolve(projectRoot, TOML_FILE);
  const content = readFileSync(tomlPath, "utf-8");
  return toml.parse(content);
}

/**
 * Sets a hex-encoded bytes entry in aiken.toml for config.<network>.<key>.
 *
 * Uses targeted text replacement to preserve file formatting.
 * Handles two cases:
 * 1. Section already exists: replace the bytes value in-place
 * 2. Section does not exist: append it at the end of the network's config block
 */
function setTomlHexValue(
  projectRoot: string,
  network: string,
  key: string,
  value: string,
): void {
  const tomlPath = resolve(projectRoot, TOML_FILE);
  let content = readFileSync(tomlPath, "utf-8");

  const sectionHeader = `[config.${network}.${key}]`;
  const sectionIndex = content.indexOf(sectionHeader);

  if (sectionIndex !== -1) {
    // Section exists — replace both bytes and encoding values
    // Scope to current section only (stop at next section header) to avoid
    // cross-section matching if the current section is missing a key.
    const afterSection = content.substring(sectionIndex + sectionHeader.length);
    const nextSectionIdx = afterSection.search(/\n\[/);
    const sectionBody =
      nextSectionIdx !== -1
        ? afterSection.substring(0, nextSectionIdx)
        : afterSection;

    // Update bytes
    const bytesMatch = sectionBody.match(/(\n\s*bytes\s*=\s*)"[^"]*"/);
    if (!bytesMatch) {
      throw new Error(
        `Failed to update bytes for config.${network}.${key} in ${TOML_FILE}: bytes key not found in existing section`,
      );
    }
    const bytesStart =
      sectionIndex + sectionHeader.length + (bytesMatch.index ?? 0);
    const bytesFullMatch = bytesMatch[0];
    const bytesPrefix = bytesMatch[1];
    content =
      content.substring(0, bytesStart) +
      `${bytesPrefix}"${value}"` +
      content.substring(bytesStart + bytesFullMatch.length);

    // Update encoding (re-search after bytes replacement shifted offsets)
    const afterSection2 = content.substring(
      sectionIndex + sectionHeader.length,
    );
    const nextSectionIdx2 = afterSection2.search(/\n\[/);
    const sectionBody2 =
      nextSectionIdx2 !== -1
        ? afterSection2.substring(0, nextSectionIdx2)
        : afterSection2;
    const encodingMatch = sectionBody2.match(/(\n\s*encoding\s*=\s*)"[^"]*"/);
    if (!encodingMatch) {
      throw new Error(
        `Failed to update encoding for config.${network}.${key} in ${TOML_FILE}: encoding key not found in existing section`,
      );
    }
    const encodingStart =
      sectionIndex + sectionHeader.length + (encodingMatch.index ?? 0);
    const encodingFullMatch = encodingMatch[0];
    const encodingPrefix = encodingMatch[1];
    content =
      content.substring(0, encodingStart) +
      `${encodingPrefix}"hex"` +
      content.substring(encodingStart + encodingFullMatch.length);
  } else {
    // Section does not exist — find the insertion point.
    // Insert before the next [config.<different_network>] or at end of file.
    const networkPrefix = `[config.${network}.`;
    const lines = content.split("\n");
    let lastNetworkLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (
        trimmed.startsWith(networkPrefix) ||
        trimmed.startsWith(`[config.${network}]`)
      ) {
        // Find the last line of this section's content
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith("[")) {
          j++;
        }
        lastNetworkLine = j - 1;
      }
    }

    const newSection = `\n${sectionHeader}\nbytes = "${value}"\nencoding = "hex"\n`;

    if (lastNetworkLine !== -1) {
      // Insert after the last line belonging to the network
      const before = lines.slice(0, lastNetworkLine + 1).join("\n");
      const after = lines.slice(lastNetworkLine + 1).join("\n");
      content = before + newSection + after;
    } else {
      // Network not found at all — append at end of file
      content = content.trimEnd() + "\n" + newSection;
    }
  }

  writeTomlAtomic(projectRoot, content);
}

/**
 * Atomically writes content to aiken.toml using a temp file + rename.
 */
function writeTomlAtomic(projectRoot: string, content: string): void {
  const tomlPath = resolve(projectRoot, TOML_FILE);
  const tmpPath = `${tomlPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, content, { mode: 0o644 });
  renameSync(tmpPath, tomlPath);
}

// ---------------------------------------------------------------------------
// Blueprint (plutus.json) Operations
// ---------------------------------------------------------------------------

function readBlueprint(path: string): PlutusBlueprint {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as PlutusBlueprint;
}

function validatorHashByTitle(
  blueprint: PlutusBlueprint,
  title: string,
): string {
  const validator = blueprint.validators.find((v) => v.title === title);
  if (!validator) {
    throw new Error(`Validator '${title}' not found in blueprint`);
  }
  return validator.hash;
}

function validatorCompiledCode(
  blueprint: PlutusBlueprint,
  title: string,
): string {
  const validator = blueprint.validators.find((v) => v.title === title);
  if (!validator) {
    throw new Error(`Validator '${title}' not found in blueprint`);
  }
  return validator.compiledCode;
}

/**
 * Verifies that the blueprint file exists, was refreshed after startedAt,
 * and contains valid JSON.
 */
function ensureBlueprintIsCurrent(
  blueprintPath: string,
  description: string,
  startedAt: number,
): void {
  if (!existsSync(blueprintPath)) {
    throw new Error(`${blueprintPath} not found after ${description}.`);
  }

  const mtime = Math.floor(statSync(blueprintPath).mtimeMs / 1000);
  if (mtime < startedAt) {
    throw new Error(`${blueprintPath} was not refreshed after ${description}.`);
  }

  // Validate JSON
  try {
    JSON.parse(readFileSync(blueprintPath, "utf-8"));
  } catch {
    throw new Error(
      `${blueprintPath} could not be parsed after ${description}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Hash Update Operations
// ---------------------------------------------------------------------------

function updateHash(
  projectRoot: string,
  network: string,
  blueprint: PlutusBlueprint,
  mapping: ValidatorMapping,
): void {
  const hash = validatorHashByTitle(blueprint, mapping.title);
  if (!hash || hash === "null") {
    throw new Error(`Validator ${mapping.title} returned no hash in blueprint`);
  }
  setTomlHexValue(projectRoot, network, mapping.tomlKey, hash);
}

function updateHashes(
  projectRoot: string,
  network: string,
  blueprint: PlutusBlueprint,
  mappings: readonly ValidatorMapping[],
): void {
  for (const mapping of mappings) {
    updateHash(projectRoot, network, blueprint, mapping);
  }
}

function updateCnightPolicyIfNotMainnet(
  projectRoot: string,
  network: string,
  blueprint: PlutusBlueprint,
): void {
  if (network === "mainnet") {
    console.log(
      "Skipping cnight_policy update for mainnet (managed separately)",
    );
    return;
  }

  let tcnightHash: string;
  try {
    tcnightHash = validatorHashByTitle(
      blueprint,
      "test_cnight_no_audit.tcnight_mint_infinite.else",
    );
  } catch {
    console.log(
      "Warning: Could not get tcnight_mint_infinite hash, keeping existing cnight_policy",
    );
    return;
  }

  if (!tcnightHash || tcnightHash === "null" || /^0+$/.test(tcnightHash)) {
    throw new Error(
      `tcnight_mint_infinite returned invalid hash: '${tcnightHash}'`,
    );
  }

  console.log(
    `Updating cnight_policy for ${network} network to tcnight_mint_infinite hash...`,
  );
  setTomlHexValue(projectRoot, network, "cnight_policy", tcnightHash);
}

// ---------------------------------------------------------------------------
// Dependency Verification
// ---------------------------------------------------------------------------

function verifyLogicDependency(
  blueprint: PlutusBlueprint,
  dep: LogicDependency,
): boolean {
  let dependencyHash: string;
  try {
    dependencyHash = validatorHashByTitle(blueprint, dep.dependencyValidator);
  } catch {
    console.error(
      `Warning: Dependency ${dep.dependencyValidator} not found in blueprint`,
    );
    return false;
  }

  let compiledCode: string;
  try {
    compiledCode = validatorCompiledCode(blueprint, dep.logicValidator);
  } catch {
    console.error(
      `Warning: Validator ${dep.logicValidator} not found in blueprint`,
    );
    return false;
  }

  const dependencyLower = dependencyHash.toLowerCase();
  const compiledLower = compiledCode.toLowerCase();

  if (!compiledLower.includes(dependencyLower)) {
    console.error(
      `Warning: ${dep.logicValidator} does not embed dependency ${dep.dependencyValidator}`,
    );
    return false;
  }

  return true;
}

function verifyThresholdConfigEntry(
  projectRoot: string,
  network: string,
  blueprint: PlutusBlueprint,
  check: { displayName: string; tomlKey: string; validatorTitle: string },
): boolean {
  let expectedHash: string;
  try {
    expectedHash = validatorHashByTitle(blueprint, check.validatorTitle);
  } catch {
    console.error(
      `Warning: Validator ${check.validatorTitle} not found in blueprint`,
    );
    return false;
  }

  const parsed = readToml(projectRoot);
  const networkConfig = (
    parsed.config as Record<string, Record<string, unknown>>
  )?.[network];
  const entry = networkConfig?.[check.tomlKey] as
    | { bytes?: string }
    | undefined;
  const tomlHash = entry?.bytes;

  if (!tomlHash) {
    console.error(
      `Warning: Failed to read ${check.displayName} hash for ${network} from ${TOML_FILE}`,
    );
    return false;
  }

  if (tomlHash !== expectedHash) {
    console.error(
      `Warning: ${check.displayName} hash mismatch (${tomlHash} != ${expectedHash})`,
    );
    return false;
  }

  return true;
}

function verifyLogicDependencies(
  projectRoot: string,
  network: string,
  blueprint: PlutusBlueprint,
): boolean {
  console.log(
    "Verifying logic validators reference updated threshold hashes...",
  );

  for (const dep of LOGIC_DEPENDENCIES) {
    if (!verifyLogicDependency(blueprint, dep)) return false;
  }

  for (const check of THRESHOLD_CONFIG_CHECKS) {
    if (!verifyThresholdConfigEntry(projectRoot, network, blueprint, check))
      return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Aiken Build via Bun.spawn
// ---------------------------------------------------------------------------

async function aikenBuild(
  projectRoot: string,
  network: string,
  outputFile: string,
  traceLevel?: string,
): Promise<void> {
  const args = ["build", "-S", "--env", network, "-o", outputFile];
  if (traceLevel) {
    args.push("-t", traceLevel);
  }

  const proc = Bun.spawn(["aiken", ...args], {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`aiken build failed with exit code ${exitCode}`);
  }
}

async function compilePhase(
  projectRoot: string,
  network: string,
  outputFile: string,
  description: string,
  traceLevel?: string,
): Promise<PlutusBlueprint> {
  console.log(`Building ${description}...`);

  const startedAt = Math.floor(Date.now() / 1000);
  const blueprintPath = resolve(projectRoot, outputFile);

  await aikenBuild(projectRoot, network, outputFile, traceLevel);
  ensureBlueprintIsCurrent(blueprintPath, description, startedAt);

  return readBlueprint(blueprintPath);
}

function resetBuildLock(projectRoot: string): void {
  const lockPath = resolve(projectRoot, LOCK_FILE);
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

// ---------------------------------------------------------------------------
// Refresh all hashes from blueprint
// ---------------------------------------------------------------------------

function refreshAllValidatorHashes(
  projectRoot: string,
  network: string,
  blueprint: PlutusBlueprint,
): void {
  console.log("Refreshing validator hashes from current blueprint...");
  updateHashes(projectRoot, network, blueprint, VALIDATORS.twoStage);
  updateHashes(projectRoot, network, blueprint, VALIDATORS.forever);
  updateHashes(projectRoot, network, blueprint, VALIDATORS.thresholds);
}

// ---------------------------------------------------------------------------
// From-Deployed Mode
// ---------------------------------------------------------------------------

async function buildFromDeployed(
  opts: BuildOptions & { projectRoot: string },
): Promise<BuildResult> {
  const { network, projectRoot, traceLevel } = opts;
  const outputFile = `plutus-${network}.json`;

  // Resolve plutus.json directly from deployed-scripts/{env}/
  const deployedJsonFile = resolve(
    getDeployedScriptsPath(network),
    "plutus.json",
  );

  if (!existsSync(deployedJsonFile)) {
    throw new Error(
      `Deployed scripts file '${deployedJsonFile}' not found.\n` +
        `Make sure deployed-scripts/${network}/plutus.json exists.`,
    );
  }

  // Backup aiken.toml
  const backupFile = resolve(projectRoot, `${TOML_FILE}.backup.${process.pid}`);
  const tomlPath = resolve(projectRoot, TOML_FILE);
  copyFileSync(tomlPath, backupFile);

  try {
    // Read hashes from deployed scripts
    console.log("Reading hashes from deployed scripts...");
    const deployedBlueprint = readBlueprint(deployedJsonFile);

    // Use core functions only (cnight_minting validators are newer, not in existing deployments)
    updateHashes(
      projectRoot,
      network,
      deployedBlueprint,
      VALIDATORS.twoStageCore,
    );
    updateHashes(
      projectRoot,
      network,
      deployedBlueprint,
      VALIDATORS.foreverCore,
    );
    updateHashes(
      projectRoot,
      network,
      deployedBlueprint,
      VALIDATORS.thresholds,
    );

    // Single build
    console.log("Building validators with deployed hashes...");
    await compilePhase(
      projectRoot,
      network,
      outputFile,
      "Single Build (from deployed)",
      traceLevel,
    );

    console.log("==========================================");
    console.log(
      `Successfully compiled midnight-reserve-contracts for ${network} network.`,
    );
    console.log(`Blueprint written to: ${outputFile}`);
    console.log(`Built against deployed hashes from: ${deployedJsonFile}`);

    return {
      blueprintPath: resolve(projectRoot, outputFile),
      network,
      fromDeployed: true,
    };
  } finally {
    // Restore aiken.toml
    copyFileSync(backupFile, tomlPath);
    unlinkSync(backupFile);
  }
}

// ---------------------------------------------------------------------------
// Standard Multi-Phase Build
// ---------------------------------------------------------------------------

async function buildStandard(
  opts: BuildOptions & { projectRoot: string },
): Promise<BuildResult> {
  const { network, projectRoot, traceLevel } = opts;
  const outputFile = `plutus-${network}.json`;
  const blueprintPath = resolve(projectRoot, outputFile);

  // Initial compile to get tcnight_mint_infinite hash for cnight_policy
  console.log("Initial compilation for cnight_policy...");
  let blueprint = await compilePhase(
    projectRoot,
    network,
    outputFile,
    "Initial Build",
    traceLevel,
  );
  updateCnightPolicyIfNotMainnet(projectRoot, network, blueprint);

  // Phase 1: Two-stage validators
  console.log("Phase 1: Setting up two-stage validators...");
  blueprint = await compilePhase(
    projectRoot,
    network,
    outputFile,
    "Two-Stage Validators",
    traceLevel,
  );
  console.log("Updating two-stage validator hashes...");
  updateHashes(projectRoot, network, blueprint, VALIDATORS.twoStage);

  // Phase 2: Forever validators
  console.log("Phase 2: Setting up forever validators...");
  blueprint = await compilePhase(
    projectRoot,
    network,
    outputFile,
    "Forever Validators",
    traceLevel,
  );
  console.log("Updating forever validator hashes...");
  updateHashes(projectRoot, network, blueprint, VALIDATORS.forever);

  // Phase 3: Threshold validators
  console.log("Phase 3: Setting up threshold validators...");
  blueprint = await compilePhase(
    projectRoot,
    network,
    outputFile,
    "Threshold Validators",
    traceLevel,
  );
  console.log("Updating threshold validator hashes...");
  updateHashes(projectRoot, network, blueprint, VALIDATORS.thresholds);

  // Final compilation with all hashes in place
  console.log("Final compilation...");
  const startedAt = Math.floor(Date.now() / 1000);
  await aikenBuild(projectRoot, network, outputFile, traceLevel);
  ensureBlueprintIsCurrent(blueprintPath, "Final compilation", startedAt);
  blueprint = readBlueprint(blueprintPath);
  refreshAllValidatorHashes(projectRoot, network, blueprint);

  // Verification loop with retry
  let verifyAttempt = 1;
  while (!verifyLogicDependencies(projectRoot, network, blueprint)) {
    if (verifyAttempt >= MAX_VERIFY_ATTEMPTS) {
      throw new Error(
        "Logic validators still reference stale threshold hashes.",
      );
    }

    console.log(
      "Detected stale logic bytecode; rebuilding with refreshed hashes...",
    );
    resetBuildLock(projectRoot);

    if (existsSync(blueprintPath)) {
      unlinkSync(blueprintPath);
    }

    const retryStartedAt = Math.floor(Date.now() / 1000);
    await aikenBuild(projectRoot, network, outputFile, traceLevel);
    ensureBlueprintIsCurrent(
      blueprintPath,
      "Final compilation",
      retryStartedAt,
    );
    blueprint = readBlueprint(blueprintPath);
    refreshAllValidatorHashes(projectRoot, network, blueprint);
    verifyAttempt++;
  }

  console.log("==========================================");
  console.log(
    `Successfully compiled midnight-reserve-contracts for ${network} network.`,
  );
  console.log(`Blueprint written to: ${outputFile}`);
  console.log(
    "All validators have been compiled and hashes updated in aiken.toml",
  );

  return {
    blueprintPath,
    network,
    fromDeployed: false,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the Aiken contracts for the given network.
 *
 * Replicates the full behavior of build_contracts.sh:
 * - Multi-phase compilation with hash extraction between phases
 * - From-deployed mode for building against existing deployments
 * - Dependency verification with retry logic
 *
 * @param opts Build configuration
 * @returns Build result with blueprint path
 */
export async function buildContracts(opts: BuildOptions): Promise<BuildResult> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const network = opts.network.toLowerCase();
  const tomlPath = resolve(projectRoot, TOML_FILE);

  // Validate aiken.toml exists and is readable
  if (!existsSync(tomlPath)) {
    throw new Error(`TOML file '${TOML_FILE}' not found.`);
  }

  console.log(`Starting compilation for network: ${network}`);
  if (opts.fromDeployed) {
    console.log(
      `Mode: Building against deployed hashes from deployed-scripts/${network}/plutus.json`,
    );
  }
  console.log("==========================================");

  if (opts.fromDeployed) {
    return buildFromDeployed({ ...opts, network, projectRoot });
  }

  return buildStandard({ ...opts, network, projectRoot });
}

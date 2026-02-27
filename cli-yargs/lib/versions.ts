import { resolve } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from "fs";
import { execSync, execFileSync } from "child_process";

export interface VersionInfo {
  round: bigint;
  logicRound: bigint;
  timestamp: string;
  gitCommit: string;
}

export interface ChangeRecord {
  type: "initial" | "stage" | "promote";
  validator: string;
  oldHash?: string;
  newHash?: string;
  description?: string;
}

interface Changelog {
  timestamp: string;
  gitCommit: string;
  changes: ChangeRecord[];
}

export interface VersionsJson {
  promoted: string[];
  staged: string[];
}

/**
 * Gets the deployed-scripts path for an environment.
 */
export function getDeployedScriptsPath(env: string): string {
  const projectRoot = resolve(import.meta.dir, "../..");
  return resolve(projectRoot, `deployed-scripts/${env}`);
}

/**
 * Gets the versions.json path for an environment.
 */
function getVersionsJsonPath(env: string): string {
  return resolve(getDeployedScriptsPath(env), "versions.json");
}

/**
 * Reads versions.json for an environment.
 * Returns null if the file does not exist.
 */
export function readVersionsJson(env: string): VersionsJson | null {
  const path = getVersionsJsonPath(env);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return {
    promoted: [],
    staged: [],
    ...raw,
  } as VersionsJson;
}

/**
 * Writes versions.json for an environment.
 */
function writeVersionsJson(env: string, data: VersionsJson): void {
  const path = getVersionsJsonPath(env);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Gets the current git commit hash.
 */
function getGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Gets the current ISO timestamp.
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/** Validators excluded from promoted lists (not part of the active contract set). */
const EXCLUDED_VALIDATORS = new Set([
  "always_fails",
  "committee_bridge_forever",
  "committee_bridge_logic",
  "committee_bridge_two_stage_upgrade",
  "beefy_signer_threshold",
  "simple_bridge",
  "reserve_logicV2",
]);

/**
 * Extracts unique validator names from a plutus.json file.
 * Strips module prefix (first dot segment) and .else/.spend suffix (last dot segment).
 * Filters out v2, staging, and excluded validators.
 */
function extractValidatorNames(plutusJsonPath: string): string[] {
  const plutus = JSON.parse(readFileSync(plutusJsonPath, "utf-8"));
  const names = new Set<string>();

  for (const v of plutus.validators) {
    const parts = (v.title as string).split(".");
    // Strip first segment (module prefix) and last segment if it's "else" or "spend"
    const last = parts[parts.length - 1];
    const inner =
      last === "else" || last === "spend" ? parts.slice(1, -1) : parts.slice(1);
    const name = inner.join(".");
    if (!name) continue;
    // Filter out versioned upgrades (v2, v3, ...) and staging validators
    if (/_v\d+$/.test(name) || /_staging_/.test(name)) continue;
    if (EXCLUDED_VALIDATORS.has(name)) continue;
    names.add(name);
  }

  return [...names];
}

/**
 * Adds a validator to the staged list in versions.json.
 * Returns false if versions.json is missing.
 */
export function addStagedValidator(env: string, name: string): boolean {
  const data = readVersionsJson(env);
  if (!data) return false;
  if (!data.staged.includes(name)) {
    data.staged.push(name);
    writeVersionsJson(env, data);
  }
  return true;
}

/**
 * Promotes a validator: removes from staged[], adds to promoted[] (deduplicating).
 * Returns false if versions.json is missing.
 */
export function promoteValidator(env: string, name: string): boolean {
  const data = readVersionsJson(env);
  if (!data) return false;
  data.staged = data.staged.filter((s) => s !== name);
  if (!data.promoted.includes(name)) {
    data.promoted.push(name);
  }
  writeVersionsJson(env, data);
  return true;
}

/**
 * Looks up a promoted validator's hash from the deployed plutus.json.
 * Returns the script hash if found, or null on any failure.
 */
export function getPromotedValidatorHash(
  env: string,
  logicV2Name: string,
): string | null {
  try {
    const plutusPath = resolve(getDeployedScriptsPath(env), "plutus.json");
    if (!existsSync(plutusPath)) return null;
    const plutus = JSON.parse(readFileSync(plutusPath, "utf-8"));
    for (const v of plutus.validators) {
      const parts = (v.title as string).split(".");
      if (parts.length >= 2 && parts[1] === logicV2Name) {
        return v.hash as string;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves a script hash to its validator name from the deployed plutus.json.
 * Returns the inner title segment (e.g., "council_logic" or "council_logic_v2").
 */
export function resolveValidatorNameByHash(
  env: string,
  hash: string,
): string | null {
  try {
    const plutusPath = resolve(getDeployedScriptsPath(env), "plutus.json");
    if (!existsSync(plutusPath)) return null;
    const plutus = JSON.parse(readFileSync(plutusPath, "utf-8"));
    for (const v of plutus.validators) {
      if (v.hash === hash) {
        const parts = (v.title as string).split(".");
        const last = parts[parts.length - 1];
        return last === "else" || last === "spend"
          ? parts.slice(1, -1).join(".")
          : parts.slice(1).join(".");
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Saves a version snapshot directly to deployed-scripts/{env}/.
 * Writes plutus.json, contract_blueprint.ts, and changelog.json at the env root.
 */
export function saveVersionSnapshot(
  env: string,
  versionInfo: VersionInfo,
  changes: ChangeRecord[],
  plutusJsonPath: string,
  blueprintPath: string,
): void {
  const basePath = getDeployedScriptsPath(env);
  mkdirSync(basePath, { recursive: true });

  const data = readVersionsJson(env);

  // Merge: take previous env plutus.json as base, add only new validators from build
  const previousPlutusPath = resolve(basePath, "plutus.json");

  if (existsSync(previousPlutusPath)) {
    const previousPlutus = JSON.parse(
      readFileSync(previousPlutusPath, "utf-8"),
    );
    const buildPlutus = JSON.parse(readFileSync(plutusJsonPath, "utf-8"));

    const previousTitles = new Set(
      previousPlutus.validators.map((v: { title: string }) => v.title),
    );
    const newValidators = buildPlutus.validators.filter(
      (v: { title: string }) => !previousTitles.has(v.title),
    );

    const mergedPlutus = {
      ...previousPlutus,
      validators: [...previousPlutus.validators, ...newValidators],
    };

    const mergedPlutusPath = resolve(basePath, "plutus.json");
    writeFileSync(
      mergedPlutusPath,
      JSON.stringify(mergedPlutus, null, 2) + "\n",
    );

    // Regenerate contract_blueprint.ts from merged plutus.json
    const blueprintOutputPath = resolve(basePath, "contract_blueprint.ts");
    execFileSync("bunx", [
      "@blaze-cardano/blueprint@latest",
      mergedPlutusPath,
      "-o",
      blueprintOutputPath,
    ]);
  } else {
    // No previous version — full copy (initial deployment)
    copyFileSync(plutusJsonPath, resolve(basePath, "plutus.json"));
    copyFileSync(blueprintPath, resolve(basePath, "contract_blueprint.ts"));
  }

  // Extract promoted validator names
  const promoted = extractValidatorNames(resolve(basePath, "plutus.json"));

  // Write changelog.json
  const changelog: Changelog = {
    timestamp: versionInfo.timestamp || getCurrentTimestamp(),
    gitCommit: versionInfo.gitCommit || getGitCommit(),
    changes,
  };

  writeFileSync(
    resolve(basePath, "changelog.json"),
    JSON.stringify(changelog, null, 2) + "\n",
  );

  if (data) {
    // Merge: keep existing promoted entries (e.g., v2 validators added by promoteValidator)
    // and add any new base validators from the fresh extraction
    const existingPromoted = new Set(data.promoted);
    for (const name of promoted) {
      existingPromoted.add(name);
    }
    data.promoted = [...existingPromoted];
    writeVersionsJson(env, data);
  } else {
    writeVersionsJson(env, {
      promoted,
      staged: [],
    });
  }
}

/**
 * Merges a single staged validator into deployed-scripts/{env}/plutus.json.
 * Only the validator matching targetHash is added (new) or replaced (same title, different hash).
 * All other validators in the deployed plutus.json are preserved untouched.
 * Does NOT create a version entry or modify versions.json.
 */
export function mergeValidatorToDeployedScripts(
  env: string,
  targetHash: string,
  buildPlutuJsonPath: string,
): void {
  const basePath = getDeployedScriptsPath(env);
  const deployedPlutusPath = resolve(basePath, "plutus.json");

  // Throw if deployed plutus.json is missing
  if (!existsSync(deployedPlutusPath)) {
    throw new Error(
      `deployed-scripts/${env}/plutus.json not found. Deploy first before staging an upgrade.`,
    );
  }

  // Read build plutus.json
  if (!existsSync(buildPlutuJsonPath)) {
    throw new Error(
      `Build plutus.json not found at ${buildPlutuJsonPath}. Run 'just build' first.`,
    );
  }

  const deployedPlutus = JSON.parse(readFileSync(deployedPlutusPath, "utf-8"));
  const buildPlutus = JSON.parse(readFileSync(buildPlutuJsonPath, "utf-8"));

  // Find validator in build plutus by hash field
  const buildValidator = buildPlutus.validators.find(
    (v: { hash: string }) => v.hash === targetHash,
  );
  if (!buildValidator) {
    throw new Error(
      `Validator with hash '${targetHash}' not found in build plutus.json (${buildPlutuJsonPath}).`,
    );
  }

  const targetTitle: string = buildValidator.title;

  // Remove any existing entry with the same title (handles same-title replacement)
  const filteredValidators = deployedPlutus.validators.filter(
    (v: { title: string }) => v.title !== targetTitle,
  );

  // Append the new build validator
  const mergedPlutus = {
    ...deployedPlutus,
    validators: [...filteredValidators, buildValidator],
  };

  writeFileSync(
    deployedPlutusPath,
    JSON.stringify(mergedPlutus, null, 2) + "\n",
  );

  // Regenerate contract_blueprint.ts from merged plutus.json
  const blueprintOutputPath = resolve(basePath, "contract_blueprint.ts");
  execFileSync("bunx", [
    "@blaze-cardano/blueprint@latest",
    deployedPlutusPath,
    "-o",
    blueprintOutputPath,
  ]);
}

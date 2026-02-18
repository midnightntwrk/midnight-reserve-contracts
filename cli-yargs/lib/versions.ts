import { resolve } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
} from "fs";
import { execSync } from "child_process";

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
  version: string;
  previousVersion: string | null;
  timestamp: string;
  gitCommit: string;
  changes: ChangeRecord[];
}

export interface VersionsJson {
  current: string;
  versions: string[];
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
function readVersionsJson(env: string): VersionsJson | null {
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
 * Gets the current version for an environment by reading versions.json.
 *
 * @returns The current version name (e.g., "v1") or null if not set
 */
export function getCurrentVersion(env: string): string | null {
  const data = readVersionsJson(env);
  return data?.current ?? null;
}

/**
 * Sets the current version in versions.json.
 * Creates versions.json if it doesn't exist.
 */
export function setCurrentVersion(env: string, version: string): void {
  // Validate target version directory exists
  const versionDir = resolve(getDeployedScriptsPath(env), "versions", version);
  if (!existsSync(versionDir)) {
    throw new Error(
      `Cannot set current version to '${version}': directory not found at ${versionDir}`,
    );
  }

  const data = readVersionsJson(env);
  if (data) {
    data.current = version;
    if (!data.versions.includes(version)) {
      data.versions.push(version);
    }
    writeVersionsJson(env, data);
  } else {
    writeVersionsJson(env, {
      current: version,
      versions: [version],
      promoted: [],
      staged: [],
    });
  }
}

/**
 * Gets the next version number by reading existing version directories.
 */
export function getNextVersionNumber(env: string): number {
  const basePath = getDeployedScriptsPath(env);
  const versionsPath = resolve(basePath, "versions");

  if (!existsSync(versionsPath)) {
    return 1;
  }

  const dirs = readdirSync(versionsPath);
  let max = 0;
  for (const dir of dirs) {
    const match = dir.match(/^v(\d+)$/);
    if (match) {
      const n = parseInt(match[1]);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Gets the version folder name derived from existing version directories.
 */
function getVersionFolderName(env: string): string {
  return `v${getNextVersionNumber(env)}`;
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

/**
 * Extracts unique validator names from a plutus.json file.
 * Strips module prefix (first dot segment) and .else/.spend suffix (last dot segment).
 * Filters out v2 and staging validators.
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
    // Filter out v2 and staging validators
    if (/_v2$/.test(name) || /_staging_/.test(name)) continue;
    names.add(name);
  }

  return [...names];
}

/**
 * Adds a validator to the staged list in versions.json.
 */
export function addStagedValidator(env: string, name: string): void {
  const data = readVersionsJson(env);
  if (!data) return;
  if (!data.staged.includes(name)) {
    data.staged.push(name);
    writeVersionsJson(env, data);
  }
}

/**
 * Promotes a validator: removes from staged[], adds to promoted[] (deduplicating).
 */
export function promoteValidator(env: string, name: string): void {
  const data = readVersionsJson(env);
  if (!data) return;
  data.staged = data.staged.filter((s) => s !== name);
  if (!data.promoted.includes(name)) {
    data.promoted.push(name);
  }
  writeVersionsJson(env, data);
}

/**
 * Saves a version snapshot to deployed-scripts/{env}/versions/{version}/
 */
export function saveVersionSnapshot(
  env: string,
  versionInfo: VersionInfo,
  changes: ChangeRecord[],
  plutusJsonPath: string,
  blueprintPath: string,
): string {
  const basePath = getDeployedScriptsPath(env);
  const versionName = getVersionFolderName(env);
  const versionPath = resolve(basePath, "versions", versionName);

  // Create version directory
  mkdirSync(versionPath, { recursive: true });

  // Merge: take previous version's plutus.json as base, add only new validators from build
  const previousVersionName = getCurrentVersion(env);
  const previousPlutusPath = previousVersionName
    ? resolve(basePath, "versions", previousVersionName, "plutus.json")
    : null;

  if (previousPlutusPath && existsSync(previousPlutusPath)) {
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

    const mergedPlutusPath = resolve(versionPath, "plutus.json");
    writeFileSync(
      mergedPlutusPath,
      JSON.stringify(mergedPlutus, null, 2) + "\n",
    );

    // Regenerate contract_blueprint.ts from merged plutus.json
    const blueprintOutputPath = resolve(versionPath, "contract_blueprint.ts");
    execSync(
      `bunx @blaze-cardano/blueprint@latest ${mergedPlutusPath} -o ${blueprintOutputPath}`,
    );
  } else {
    // No previous version — full copy (initial deployment)
    copyFileSync(plutusJsonPath, resolve(versionPath, "plutus.json"));
    copyFileSync(blueprintPath, resolve(versionPath, "contract_blueprint.ts"));
  }

  // Extract promoted validator names from the versioned plutus.json
  const versionedPlutusPath = resolve(versionPath, "plutus.json");
  const promoted = extractValidatorNames(versionedPlutusPath);

  // Get previous version for changelog
  const previousVersion = getCurrentVersion(env);

  // Write changelog.json
  const changelog: Changelog = {
    version: versionName,
    previousVersion,
    timestamp: versionInfo.timestamp || getCurrentTimestamp(),
    gitCommit: versionInfo.gitCommit || getGitCommit(),
    changes,
  };

  writeFileSync(
    resolve(versionPath, "changelog.json"),
    JSON.stringify(changelog, null, 2) + "\n",
  );

  // Record version in versions.json (don't change current — that's setCurrentVersion's job)
  const data = readVersionsJson(env);
  if (data) {
    if (!data.versions.includes(versionName)) {
      data.versions.push(versionName);
    }
    data.promoted = promoted;
    writeVersionsJson(env, data);
  } else {
    writeVersionsJson(env, {
      current: "",
      versions: [versionName],
      promoted,
      staged: [],
    });
  }

  return versionName;
}

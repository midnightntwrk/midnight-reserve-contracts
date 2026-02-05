import { resolve } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  copyFileSync,
  readdirSync,
  lstatSync,
  readlinkSync,
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

export interface Changelog {
  version: string; // "v1", "v2", etc.
  previousVersion: string | null;
  timestamp: string;
  gitCommit: string;
  changes: ChangeRecord[];
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
export function getVersionFolderName(env: string): string {
  return `v${getNextVersionNumber(env)}`;
}

/**
 * Gets the deployed-scripts path for an environment.
 */
export function getDeployedScriptsPath(env: string): string {
  const projectRoot = resolve(import.meta.dir, "../..");
  return resolve(projectRoot, `deployed-scripts/${env}`);
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
 * Saves a version snapshot to deployed-scripts/{env}/versions/{version}/
 *
 * @param env - The environment name
 * @param versionInfo - Version information (round, logicRound)
 * @param changes - List of changes in this version
 * @param plutusJsonPath - Path to the source plutus.json file
 * @param blueprintPath - Path to the source contract_blueprint.ts file
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

    // NOTE: The spread of previousPlutus copies the previous version's `definitions` field.
    // If a future version introduces new Aiken types referenced by new validators, the
    // definitions from the previous version may not include those types. Currently safe
    // because v2 validators use `"schema": {}` redeemers. Consider merging `definitions`
    // fields if future validators need typed redeemers.
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

  return versionName;
}

/**
 * Updates the current symlinks to point to a specific version.
 *
 * @param env - The environment name
 * @param version - The version folder name (e.g., "v1")
 */
export function updateCurrentSymlinks(env: string, version: string): void {
  const basePath = getDeployedScriptsPath(env);
  const versionPath = resolve(basePath, "versions", version);

  if (!existsSync(versionPath)) {
    throw new Error(`Version folder not found: ${versionPath}`);
  }

  const files = ["plutus.json", "contract_blueprint.ts"];

  for (const file of files) {
    const symlinkPath = resolve(basePath, file);
    const targetPath = `versions/${version}/${file}`;

    // Remove existing symlink if it exists
    if (existsSync(symlinkPath)) {
      unlinkSync(symlinkPath);
    }

    // Create new symlink (relative path)
    symlinkSync(targetPath, symlinkPath);
  }
}

/**
 * Gets the version history for an environment by reading all changelog.json files.
 *
 * @param env - The environment name
 * @returns Array of Changelog objects sorted by version (newest first)
 */
export function getVersionHistory(env: string): Changelog[] {
  const basePath = getDeployedScriptsPath(env);
  const versionsPath = resolve(basePath, "versions");

  if (!existsSync(versionsPath)) {
    return [];
  }

  const changelogs: Changelog[] = [];
  const versionDirs = readdirSync(versionsPath);

  for (const versionDir of versionDirs) {
    const changelogPath = resolve(versionsPath, versionDir, "changelog.json");
    if (existsSync(changelogPath)) {
      try {
        const content = readFileSync(changelogPath, "utf-8");
        changelogs.push(JSON.parse(content) as Changelog);
      } catch {
        // Skip invalid changelog files
      }
    }
  }

  // Sort by version (parse round and logic numbers)
  changelogs.sort((a, b) => {
    const parseVer = (v: string) => {
      const vMatch = v.match(/^v(\d+)$/);
      if (vMatch) return { round: 0, logic: parseInt(vMatch[1]) - 1 };
      const match = v.match(/round_(\d+)_logic_(\d+)/);
      if (!match) return { round: 0, logic: 0 };
      return { round: parseInt(match[1]), logic: parseInt(match[2]) };
    };
    const va = parseVer(a.version);
    const vb = parseVer(b.version);
    if (va.round !== vb.round) return vb.round - va.round;
    return vb.logic - va.logic;
  });

  return changelogs;
}

/**
 * Gets the current version for an environment by reading the symlink target.
 *
 * @param env - The environment name
 * @returns The current version name (e.g., "v1") or null if not set
 */
export function getCurrentVersion(env: string): string | null {
  const basePath = getDeployedScriptsPath(env);
  const symlinkPath = resolve(basePath, "plutus.json");

  if (!existsSync(symlinkPath)) {
    return null;
  }

  try {
    const stats = lstatSync(symlinkPath);
    if (!stats.isSymbolicLink()) {
      return null;
    }

    // Read symlink target (e.g., "versions/v1/plutus.json")
    const target = readlinkSync(symlinkPath);
    const match = target.match(/versions\/([^/]+)\//);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Parses a version string into round and logic round numbers.
 *
 * @param version - The version string (e.g., "v1")
 * @returns Object with round and logicRound as bigints, or null if invalid
 */
export function parseVersion(
  version: string,
): { round: bigint; logicRound: bigint } | null {
  // New format: v1, v2, etc.
  const vMatch = version.match(/^v(\d+)$/);
  if (vMatch) {
    return {
      round: 0n,
      logicRound: BigInt(parseInt(vMatch[1]) - 1),
    };
  }
  // Legacy format: round_0_logic_0
  const match = version.match(/round_(\d+)_logic_(\d+)/);
  if (!match) return null;
  return {
    round: BigInt(match[1]),
    logicRound: BigInt(match[2]),
  };
}

/**
 * Checks if deployed-scripts exists for an environment.
 *
 * @param env - The environment name
 * @returns True if the deployed-scripts/{env}/ directory exists
 */
export function hasDeployedScripts(env: string): boolean {
  const basePath = getDeployedScriptsPath(env);
  return existsSync(basePath);
}

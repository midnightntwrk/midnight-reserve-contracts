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
  version: string; // "round_0_logic_1"
  previousVersion: string | null;
  timestamp: string;
  gitCommit: string;
  changes: ChangeRecord[];
}

/**
 * Gets the version folder name from round and logic round numbers.
 */
export function getVersionFolderName(
  round: bigint,
  logicRound: bigint,
): string {
  return `round_${round}_logic_${logicRound}`;
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
): void {
  const basePath = getDeployedScriptsPath(env);
  const versionName = getVersionFolderName(
    versionInfo.round,
    versionInfo.logicRound,
  );
  const versionPath = resolve(basePath, "versions", versionName);

  // Create version directory
  mkdirSync(versionPath, { recursive: true });

  // Copy plutus.json
  copyFileSync(plutusJsonPath, resolve(versionPath, "plutus.json"));

  // Copy contract_blueprint.ts
  copyFileSync(blueprintPath, resolve(versionPath, "contract_blueprint.ts"));

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
}

/**
 * Updates the current symlinks to point to a specific version.
 *
 * @param env - The environment name
 * @param version - The version folder name (e.g., "round_0_logic_1")
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
    const parseVersion = (v: string) => {
      const match = v.match(/round_(\d+)_logic_(\d+)/);
      if (!match) return { round: 0, logic: 0 };
      return { round: parseInt(match[1]), logic: parseInt(match[2]) };
    };
    const va = parseVersion(a.version);
    const vb = parseVersion(b.version);
    if (va.round !== vb.round) return vb.round - va.round;
    return vb.logic - va.logic;
  });

  return changelogs;
}

/**
 * Gets the current version for an environment by reading the symlink target.
 *
 * @param env - The environment name
 * @returns The current version name (e.g., "round_0_logic_1") or null if not set
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

    // Read symlink target (e.g., "versions/round_0_logic_0/plutus.json")
    const target = readlinkSync(symlinkPath);
    const match = target.match(/versions\/(round_\d+_logic_\d+)\//);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Parses a version string into round and logic round numbers.
 *
 * @param version - The version string (e.g., "round_0_logic_1")
 * @returns Object with round and logicRound as bigints, or null if invalid
 */
export function parseVersion(
  version: string,
): { round: bigint; logicRound: bigint } | null {
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

#!/usr/bin/env bun
/**
 * One-time migration script: generate versions.json for all deployed-scripts environments.
 *
 * Reads existing symlink targets to determine the current version, scans for v* directories,
 * and writes a versions.json file in each environment directory.
 *
 * Usage:
 *   bun scripts/migrate-to-versions-json.ts          # dry-run (default)
 *   bun scripts/migrate-to-versions-json.ts --write   # actually write files
 */
import { resolve } from "path";
import {
  existsSync,
  readdirSync,
  readlinkSync,
  lstatSync,
  writeFileSync,
  statSync,
} from "fs";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const DEPLOYED_SCRIPTS = resolve(PROJECT_ROOT, "deployed-scripts");

interface VersionsJson {
  current: string;
  versions: string[];
}

const write = process.argv.includes("--write");

if (!write) {
  console.log("=== DRY RUN (pass --write to write files) ===\n");
}

const envDirs = readdirSync(DEPLOYED_SCRIPTS).filter((name) => {
  const full = resolve(DEPLOYED_SCRIPTS, name);
  return statSync(full).isDirectory();
});

let migrated = 0;
let skipped = 0;
let warnings = 0;

for (const env of envDirs.sort()) {
  const envPath = resolve(DEPLOYED_SCRIPTS, env);
  const versionsJsonPath = resolve(envPath, "versions.json");

  console.log(`--- ${env} ---`);

  // Idempotent: skip if versions.json already exists
  if (existsSync(versionsJsonPath)) {
    console.log(`  SKIP: versions.json already exists`);
    skipped++;
    continue;
  }

  // Read symlink to determine current version
  const symlinkPath = resolve(envPath, "plutus.json");
  let currentVersion: string | null = null;

  if (!existsSync(symlinkPath)) {
    console.log(`  WARN: no plutus.json found, skipping`);
    warnings++;
    continue;
  }

  try {
    const stats = lstatSync(symlinkPath);
    if (!stats.isSymbolicLink()) {
      console.log(`  WARN: plutus.json is not a symlink, skipping`);
      warnings++;
      continue;
    }
    const target = readlinkSync(symlinkPath);
    const match = target.match(/versions\/([^/]+)\//);
    if (match) {
      currentVersion = match[1];
    } else {
      console.log(
        `  WARN: symlink target '${target}' does not match versions/*/... pattern, skipping`,
      );
      warnings++;
      continue;
    }
  } catch (err) {
    console.log(`  WARN: failed to read symlink: ${err}`);
    warnings++;
    continue;
  }

  // Scan for v* directories
  const versionsDir = resolve(envPath, "versions");
  if (!existsSync(versionsDir)) {
    console.log(`  WARN: no versions/ directory, skipping`);
    warnings++;
    continue;
  }

  const allDirs = readdirSync(versionsDir);
  const vDirs = allDirs
    .filter((d) => /^v\d+$/.test(d))
    .sort((a, b) => {
      const na = parseInt(a.slice(1));
      const nb = parseInt(b.slice(1));
      return na - nb;
    });

  if (vDirs.length === 0) {
    console.log(`  WARN: no v* directories found in versions/, skipping`);
    warnings++;
    continue;
  }

  // Validate current version directory exists
  const currentVersionDir = resolve(versionsDir, currentVersion);
  if (!existsSync(currentVersionDir)) {
    console.log(
      `  WARN: current version '${currentVersion}' directory does not exist, skipping`,
    );
    warnings++;
    continue;
  }

  const data: VersionsJson = {
    current: currentVersion,
    versions: vDirs,
  };

  const ignored = allDirs.filter(
    (d) => !vDirs.includes(d) && /^round_/.test(d),
  );
  if (ignored.length > 0) {
    console.log(`  ignoring legacy dirs: ${ignored.join(", ")}`);
  }

  console.log(
    `  current: ${data.current}, versions: [${data.versions.join(", ")}]`,
  );

  if (write) {
    writeFileSync(versionsJsonPath, JSON.stringify(data, null, 2) + "\n");
    console.log(`  WROTE: ${versionsJsonPath}`);
  } else {
    console.log(`  WOULD WRITE: ${versionsJsonPath}`);
  }
  migrated++;
}

console.log(`\n=== Summary ===`);
console.log(`Environments: ${envDirs.length}`);
console.log(`Migrated: ${migrated}`);
console.log(`Skipped (already exists): ${skipped}`);
console.log(`Warnings: ${warnings}`);
if (!write && migrated > 0) {
  console.log(`\nRe-run with --write to write files.`);
}

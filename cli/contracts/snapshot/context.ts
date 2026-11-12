/**
 * Where snapshots live: the DeployedScripts service names the root (the
 * repository's deployed-scripts/, or a temporary directory in tests), and
 * each environment's snapshot is `<root>/<env>/`.
 */
import { resolve } from "path";
import { Context, Effect, Layer } from "effect";
import { PROJECT_ROOT } from "../paths";

/** The directory that holds each environment's snapshot. */
export class DeployedScripts extends Context.Tag("DeployedScripts")<
  DeployedScripts,
  { readonly root: string }
>() {}

/** The repository's deployed-scripts/. */
export const DeployedScriptsLive = Layer.succeed(DeployedScripts, {
  root: resolve(PROJECT_ROOT, "deployed-scripts"),
});

/** Snapshots under `root`. */
export const DeployedScriptsAt = (root: string) =>
  Layer.succeed(DeployedScripts, { root });

/** The snapshot directory of an environment. */
export const snapshotDirOf = (
  env: string,
): Effect.Effect<string, never, DeployedScripts> =>
  Effect.map(DeployedScripts, ({ root }) => resolve(root, env));

/** A snapshot directory's four files. */
export interface SnapshotFiles {
  readonly plutus: string;
  readonly blueprint: string;
  readonly versions: string;
  readonly changelog: string;
}

/** The files of a snapshot directory. */
export const snapshotFiles = (snapshotDir: string): SnapshotFiles => ({
  plutus: resolve(snapshotDir, "plutus.json"),
  blueprint: resolve(snapshotDir, "contract_blueprint.ts"),
  versions: resolve(snapshotDir, "versions.json"),
  changelog: resolve(snapshotDir, "changelog.json"),
});

/** The files of an environment's snapshot. */
export const filesOf = (
  env: string,
): Effect.Effect<SnapshotFiles, never, DeployedScripts> =>
  Effect.map(snapshotDirOf(env), snapshotFiles);

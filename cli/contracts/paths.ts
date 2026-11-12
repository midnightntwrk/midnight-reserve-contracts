/** The repository paths the CLI resolves from its own source. */
import { resolve } from "path";
import type { Profile } from "../config/network-mapping";

/** The repository root: aiken.toml, the build output, deployed-scripts/ and node_modules/. */
export const PROJECT_ROOT = resolve(import.meta.dir, "../..");

/** The build output of an aiken.toml profile under `root`: its plutus.json and generated blueprint. */
export const buildOutput = (root: string, profile: Profile) => ({
  plutusPath: resolve(root, `plutus-${profile}.json`),
  blueprintPath: resolve(root, `contract_blueprint_${profile}.ts`),
});

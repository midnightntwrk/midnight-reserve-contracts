import type { Argv, CommandModule } from "yargs";
import { resolve } from "path";
import { copyFileSync } from "fs";
import type { GlobalOptions } from "../../lib/global-options";
import { buildContracts } from "../../lib/build-engine";

interface BuildOptions extends GlobalOptions {
  trace?: string;
}

export const command = "build";
export const describe =
  "Compile Aiken contracts and generate TypeScript bindings";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("network", {
      type: "string",
      default: "default",
      description:
        "Network/environment for Aiken build (default: default — vanilla Aiken build with no env overrides)",
    })
    .option("trace", {
      type: "string",
      choices: ["silent", "verbose", "compact"] as const,
      default: "verbose",
      description: "Aiken trace level",
    });
}

export async function handler(argv: BuildOptions) {
  const { network: env, trace } = argv;
  const projectRoot = process.cwd();

  await buildContracts({
    network: env,
    traceLevel: trace as "silent" | "verbose" | "compact" | undefined,
    projectRoot,
  });

  // Generate TypeScript bindings from the blueprint
  const outputFile = `plutus-${env.toLowerCase()}.json`;
  const bindingsFile = `contract_blueprint_${env.toLowerCase()}.ts`;

  console.log(`\nGenerating TypeScript bindings...`);
  const proc = Bun.spawn(
    ["bunx", "@blaze-cardano/blueprint@latest", outputFile, "-o", bindingsFile],
    {
      cwd: projectRoot,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Blueprint TypeScript generation failed with exit code ${exitCode}`,
    );
  }

  // Copy to contract_blueprint.ts for CLI and test imports (matches Justfile behavior)
  copyFileSync(
    resolve(projectRoot, bindingsFile),
    resolve(projectRoot, "contract_blueprint.ts"),
  );

  console.log(`TypeScript bindings written to: ${bindingsFile}`);
  console.log(`Copied to: contract_blueprint.ts`);
}

const commandModule: CommandModule<GlobalOptions, BuildOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

import type { Argv, CommandModule } from "yargs";
import type { GlobalOptions } from "../../lib/global-options";
import { buildContracts } from "../../lib/build-engine";

interface BuildFromDeployedOptions extends GlobalOptions {
  trace?: string;
}

export const command = "build-from-deployed";
export const describe =
  "Compile contracts against deployed validator hashes (single-phase build)";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("network", {
      alias: "n",
      type: "string",
      default: "default",
      description:
        "Network/environment for Aiken build (default: default — vanilla Aiken build with no env overrides)",
    })
    .option("trace", {
      type: "string",
      choices: ["silent", "verbose", "compact"] as const,
      description: "Aiken trace level",
    })
    .epilogue(
      "Build against already-deployed validator hashes from deployed-scripts/<env>/plutus.json.\n" +
        "This performs a single compilation pass instead of the full multi-phase build,\n" +
        "producing a blueprint that references the on-chain validator hashes.\n\n" +
        "Use this when you need to build transactions against an existing deployment\n" +
        "without recomputing all validator hashes from scratch.\n\n" +
        "The original aiken.toml is backed up before writing deployed hashes and\n" +
        "restored after the build completes (even on error).",
    );
}

export async function handler(argv: BuildFromDeployedOptions) {
  const { network: env, trace } = argv;
  const projectRoot = process.cwd();

  await buildContracts({
    network: env,
    traceLevel: trace as "silent" | "verbose" | "compact" | undefined,
    fromDeployed: true,
    projectRoot,
  });
}

const commandModule: CommandModule<GlobalOptions, BuildFromDeployedOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

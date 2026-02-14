import type { Argv } from "yargs";

export type GlobalOptions = {
  network: string;
  output: string;
  provider?: string;
  "dry-run": boolean;
};

export function addGlobalOptions<T>(yargs: Argv<T>): Argv<T & GlobalOptions> {
  return yargs
    .option("network", {
      alias: "n",
      type: "string",
      default: "local",
      description:
        "Network: local, preview, qanet, govnet, devnet-*, node-dev-*, preprod, mainnet (default: local)",
    })
    .option("output", {
      alias: "o",
      type: "string",
      default: "./deployments",
      description: "Output directory (default: ./deployments)",
    })
    .option("provider", {
      alias: "p",
      type: "string",
      description:
        "Provider: emulator, blockfrost, kupmios, maestro (default: emulator for local, blockfrost otherwise)",
    })
    .option("dry-run", {
      type: "boolean",
      default: false,
      description: "Build transaction without signing",
    });
}

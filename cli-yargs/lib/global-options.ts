import type { Argv } from "yargs";
import type { ProviderType } from "./types";

export type GlobalOptions = {
  network: string;
  output: string;
  provider?: ProviderType;
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
      choices: ["blockfrost", "maestro", "emulator", "kupmios"] as const,
      description:
        "Provider: emulator, blockfrost, kupmios, maestro (default: emulator for local, blockfrost otherwise)",
    })
    .option("dry-run", {
      type: "boolean",
      default: false,
      description: "Build transaction without signing",
    });
}

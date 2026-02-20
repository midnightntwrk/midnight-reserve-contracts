import type { Argv } from "yargs";
import type { ProviderType } from "./types";

export type GlobalOptions = {
  network: string;
  output: string;
  provider?: ProviderType;
};

export function addGlobalOptions<T>(yargs: Argv<T>): Argv<T & GlobalOptions> {
  return yargs
    .option("network", {
      alias: "n",
      type: "string",
      default: "local",
      description:
        "Network: local, preview, qanet, govnet, devnet-*, node-dev-*, preprod, mainnet",
    })
    .option("output", {
      alias: "o",
      type: "string",
      default: "./deployments",
      description: "Output directory",
    })
    .option("provider", {
      alias: "p",
      type: "string",
      choices: ["blockfrost", "maestro", "emulator", "kupmios"] as const,
      description: "Provider: emulator, blockfrost, kupmios, maestro",
    });
}

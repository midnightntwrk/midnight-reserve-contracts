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
        "Network: local, preview, qanet, govnet, devnet, preprod, mainnet",
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
      choices: ["blockfrost", "emulator", "kupmios"] as const,
      description: "Provider: emulator, blockfrost, kupmios",
    });
}

export type TxOptions = {
  "fee-padding": number;
};

export function addTxOptions<T>(yargs: Argv<T>): Argv<T & TxOptions> {
  return yargs.option("fee-padding", {
    type: "number",
    default: 50000,
    description: "Fee padding in lovelace (0 or greater)",
    min: 0,
  }) as unknown as Argv<T & TxOptions>;
}

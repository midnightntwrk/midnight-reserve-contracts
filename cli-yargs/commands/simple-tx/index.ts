import type { Argv, CommandModule } from "yargs";
import { Address } from "@blaze-cardano/core";
import { resolve } from "path";
import type { GlobalOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { createBlaze } from "../../lib/provider";
import {
  getDeployerAddress,
  getSimpleTxCount,
  getSimpleTxAmount,
} from "../../lib/config";
import { ensureDirectory, writeTransactionFile } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";

interface SimpleTxOptions extends GlobalOptions {
  count?: number;
  amount?: string;
  to?: string;
  "output-file": string;
}

export const command = "simple-tx";
export const describe = "Create simple transactions for testing";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("count", {
      alias: "c",
      type: "number",
      description: "Number of outputs to create",
    })
    .option("amount", {
      type: "string",
      description: "Lovelace amount per output",
    })
    .option("to", {
      type: "string",
      description: "Recipient address (defaults to DEPLOYER_ADDRESS)",
    })
    .option("output-file", {
      type: "string",
      default: "simple-tx.json",
      description: "Output filename (default: simple-tx.json)",
    });
}

export async function handler(argv: SimpleTxOptions) {
  const { network, output, to } = argv;
  const count = argv.count || getSimpleTxCount();
  const amount = argv.amount ? BigInt(argv.amount) : getSimpleTxAmount();
  const outputFile = argv["output-file"];

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);
  const recipientAddress = to || getDeployerAddress();

  console.log(`\nGenerating simple transaction on ${network} network`);
  console.log(`Creating ${count} outputs of ${amount} lovelace each`);
  console.log(`Recipient: ${recipientAddress}`);

  const providerType = argv.provider;
  const { blaze, provider } = await createBlaze(network, providerType);
  const networkId = getNetworkId(network);
  const address = Address.fromBech32(recipientAddress);

  const txBuilder = blaze.newTransaction();

  for (let i = 0; i < count; i++) {
    txBuilder.payLovelace(address, amount);
  }

  const { tx } = await completeTx(txBuilder, {
    commandName: "simple-tx",
    provider,
    networkId,
    environment: network,
  });

  ensureDirectory(deploymentDir);
  writeTransactionFile(
    outputPath,
    tx.toCbor(),
    tx.getId(),
    false,
    "Simple Transaction",
  );
  console.log("\nTransaction details:");
  console.log(`  - Outputs: ${count}`);
  console.log(`  - Amount per output: ${Number(amount) / 1_000_000} ADA`);
  console.log(`  - Total sent: ${(Number(amount) * count) / 1_000_000} ADA`);
  console.log(`\nTransaction written to ${outputPath}`);
}

const commandModule: CommandModule<GlobalOptions, SimpleTxOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

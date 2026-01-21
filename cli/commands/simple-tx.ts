import { Address } from "@blaze-cardano/core";
import { resolve } from "path";

import type { SimpleTxOptions } from "../lib/types";
import { getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import {
  printSuccess,
  printError,
  writeTransactionFile,
  ensureDirectory,
} from "../utils/output";

export async function simpleTx(options: SimpleTxOptions): Promise<void> {
  const { network, output, count, amount, to, outputFile } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  const recipientAddress = to || getDeployerAddress();

  console.log(`\nGenerating simple transaction on ${network} network`);
  console.log(`Creating ${count} outputs of ${amount} lovelace each`);
  console.log(`Recipient: ${recipientAddress}`);

  const { blaze } = await createBlaze(network, options.provider);
  const address = Address.fromBech32(recipientAddress);

  try {
    const txBuilder = blaze.newTransaction();

    for (let i = 0; i < count; i++) {
      txBuilder.payLovelace(address, amount);
    }

    const tx = await txBuilder.complete();

    ensureDirectory(deploymentDir);
    writeTransactionFile(outputPath, tx.toCbor(), tx.getId(), false);

    printSuccess("Transaction built successfully!");
    console.log("Transaction ID:", tx.getId());
    console.log("\nTransaction details:");
    console.log(`  - Outputs: ${count}`);
    console.log(`  - Amount per output: ${Number(amount) / 1_000_000} ADA`);
    console.log(`  - Total sent: ${(Number(amount) * count) / 1_000_000} ADA`);
    console.log(`\nTransaction written to ${outputPath}`);
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}

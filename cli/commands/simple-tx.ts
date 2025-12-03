import { Address } from "@blaze-cardano/core";

import type { SimpleTxOptions } from "../lib/types";
import { getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import {
  printSuccess,
  printError,
  printProgress,
  writeCborFile,
} from "../utils/output";

export async function simpleTx(options: SimpleTxOptions): Promise<void> {
  const { network, count, amount, to } = options;

  const recipientAddress = to || getDeployerAddress();

  console.log(`\nGenerating simple transaction on ${network} network`);
  console.log(`Creating ${count} outputs of ${amount} lovelace each`);
  console.log(`Recipient: ${recipientAddress}`);

  const { blaze } = await createBlaze(network, options.provider);
  const address = Address.fromBech32(recipientAddress);

  printProgress("Building transaction...");

  try {
    const txBuilder = blaze.newTransaction();

    // Add outputs
    for (let i = 0; i < count; i++) {
      txBuilder.payLovelace(address, amount);
    }

    printProgress("Completing transaction (with evaluation)...");
    const tx = await txBuilder.complete();

    // Write transaction CBOR to file
    const txCbor = tx.toCbor();
    writeCborFile("simple-tx.cbor", txCbor);

    printSuccess("Transaction built successfully!");
    console.log("Transaction ID:", tx.getId());
    console.log("\nTransaction details:");
    console.log(`  - Outputs: ${count}`);
    console.log(`  - Amount per output: ${Number(amount) / 1_000_000} ADA`);
    console.log(`  - Total sent: ${(Number(amount) * count) / 1_000_000} ADA`);
    console.log(`\nTransaction CBOR written to simple-tx.cbor`);
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}

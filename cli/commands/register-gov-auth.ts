import { Credential, CredentialType } from "@blaze-cardano/core";
import { resolve } from "path";

import type { RegisterGovAuthOptions } from "../lib/types";
import { createBlaze } from "../lib/provider";
import { getContractInstances } from "../lib/contracts";
import {
  printSuccess,
  printError,
  printProgress,
  writeTransactionFile,
} from "../utils/output";

export async function registerGovAuth(
  options: RegisterGovAuthOptions,
): Promise<void> {
  const { network, output, outputFile } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nRegistering Gov Auth scripts on ${network} network`);

  const contracts = getContractInstances();

  const mainGovAuthHash = contracts.govAuth.Script.hash();
  const stagingGovAuthHash = contracts.stagingGovAuth.Script.hash();

  console.log(`\nMain Gov Auth script hash: ${mainGovAuthHash}`);
  console.log(`Staging Gov Auth script hash: ${stagingGovAuthHash}`);

  const { blaze } = await createBlaze(network, options.provider);

  printProgress("Building transaction...");

  try {
    const tx = await blaze
      .newTransaction()
      .provideScript(contracts.govAuth.Script)
      .provideScript(contracts.stagingGovAuth.Script)
      .addRegisterStake(
        Credential.fromCore({
          hash: mainGovAuthHash,
          type: CredentialType.ScriptHash,
        }),
      )
      .addRegisterStake(
        Credential.fromCore({
          hash: stagingGovAuthHash,
          type: CredentialType.ScriptHash,
        }),
      )
      .complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    writeTransactionFile(outputPath, tx.toCbor(), tx.getId(), false);
    printSuccess(`Transaction written to ${outputPath}`);

    console.log("\nTransaction ID:", tx.getId());
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}

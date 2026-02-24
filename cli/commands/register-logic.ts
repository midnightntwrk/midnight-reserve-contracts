import { Credential, CredentialType } from "@blaze-cardano/core";
import { resolve } from "path";

import type { RegisterLogicOptions } from "../lib/types";
import { createBlaze } from "../lib/provider";
import { findScriptByHash } from "../lib/contracts";
import {
  printSuccess,
  printError,
  writeTransactionFile,
} from "../utils/output";

export async function registerLogic(
  options: RegisterLogicOptions,
): Promise<void> {
  const { network, output, outputFile, scriptHash } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(
    `\nRegistering logic script ${scriptHash} as stake credential on ${network} network`,
  );

  const logicScript = findScriptByHash(scriptHash, network, options.useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown script hash: ${scriptHash}. Could not find matching script in deployed blueprints.`,
    );
  }

  console.log(`Script found, hash: ${logicScript.hash()}`);

  const { blaze } = await createBlaze(network, options.provider);
  try {
    const tx = await blaze
      .newTransaction()
      .provideScript(logicScript)
      .addRegisterStake(
        Credential.fromCore({
          hash: logicScript.hash(),
          type: CredentialType.ScriptHash,
        }),
      )
      .complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Register Logic Stake Credential Transaction",
    );
    printSuccess(`Transaction written to ${outputPath}`);

    console.log("\nTransaction ID:", tx.getId());
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}

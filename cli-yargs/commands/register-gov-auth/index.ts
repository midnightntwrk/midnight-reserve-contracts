import type { Argv, CommandModule } from "yargs";
import { Credential, CredentialType } from "@blaze-cardano/core";
import { resolve } from "path";

import type { GlobalOptions } from "../../lib/global-options";
import { getNetworkId, type ProviderType } from "../../lib/types";
import { createBlaze } from "../../lib/provider";
import { getContractInstances } from "../../lib/contracts";
import {
  ensureDirectory,
  writeTransactionFile,
} from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";

interface RegisterGovAuthOptions extends GlobalOptions {
  "output-file": string;
  "use-build": boolean;
}

export const command = "register-gov-auth";
export const describe =
  "Register main and staging gov auth scripts as stake credentials";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("output-file", {
      type: "string",
      default: "register-gov-auth-tx.json",
      description: "Output filename (default: register-gov-auth-tx.json)",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use build-time compiled scripts instead of deployed scripts",
    });
}

export async function handler(argv: RegisterGovAuthOptions) {
  const { network, output } = argv;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, argv["output-file"]);

  console.log(`\nRegistering Gov Auth scripts on ${network} network`);

  const contracts = getContractInstances(network, argv["use-build"]);

  const mainGovAuthHash = contracts.govAuth.Script.hash();
  const stagingGovAuthHash = contracts.stagingGovAuth.Script.hash();

  console.log(`\nMain Gov Auth script hash: ${mainGovAuthHash}`);
  console.log(`Staging Gov Auth script hash: ${stagingGovAuthHash}`);

  const providerType = argv.provider as ProviderType | undefined;
  const { blaze, provider } = await createBlaze(network, providerType);
  const networkId = getNetworkId(network);

  const txBuilder = blaze
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
    );

  const { tx } = await completeTx(txBuilder, {
    commandName: "register-gov-auth",
    provider,
    networkId,
  });

  ensureDirectory(deploymentDir);
  writeTransactionFile(
    outputPath,
    tx.toCbor(),
    tx.getId(),
    false,
    "Register Government Authority Transaction",
  );

  console.log("Transaction ID:", tx.getId());
}

const commandModule: CommandModule<GlobalOptions, RegisterGovAuthOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

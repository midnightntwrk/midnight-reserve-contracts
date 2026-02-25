import type { Argv, CommandModule } from "yargs";
import { Credential, CredentialType } from "@blaze-cardano/core";
import { resolve } from "path";

import type { GlobalOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { createBlaze } from "../../lib/provider";
import { getContractInstances } from "../../lib/contracts";
import { ensureDirectory, writeTransactionFile } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";

interface RegisterGovAuthOptions extends GlobalOptions {
  "output-file": string;
}

export const command = "register-gov-auth";
export const describe =
  "Register main and staging gov auth scripts as stake credentials";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs.option("output-file", {
    type: "string",
    default: "register-gov-auth-tx.json",
    description: "Output filename (default: register-gov-auth-tx.json)",
  });
}

export async function handler(argv: RegisterGovAuthOptions) {
  const { network, output } = argv;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, argv["output-file"]);

  console.log(`\nRegistering Gov Auth scripts on ${network} network`);

  // govAuth/stagingGovAuth are audited immutable contracts — hash is identical in build vs deployed
  const contracts = getContractInstances(network, false);

  const mainGovAuthHash = contracts.govAuth.Script.hash();
  const stagingGovAuthHash = contracts.stagingGovAuth.Script.hash();

  console.log(`\nMain Gov Auth script hash: ${mainGovAuthHash}`);
  console.log(`Staging Gov Auth script hash: ${stagingGovAuthHash}`);

  const providerType = argv.provider;
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
    environment: network,
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

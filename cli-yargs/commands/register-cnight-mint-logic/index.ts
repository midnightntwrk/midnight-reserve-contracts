import type { Argv, CommandModule } from "yargs";
import { Address, Credential, CredentialType } from "@blaze-cardano/core";
import { resolve } from "path";

import type { GlobalOptions, TxOptions } from "../../lib/global-options";
import { addTxOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { getDeployerAddress } from "../../lib/config";
import { validateTxHash, validateTxIndex } from "../../lib/validation";
import { createBlaze } from "../../lib/provider";
import { getContractInstances } from "../../lib/contracts";
import { findUtxoByTxRef } from "../../lib/transaction";
import { ensureDirectory, writeTransactionFile } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";

interface RegisterCnightMintLogicOptions extends GlobalOptions, TxOptions {
  "tx-hash": string;
  "tx-index": number;
  "output-file": string;
  "use-build": boolean;
}

export const command = "register-cnight-mint-logic";
export const describe =
  "Register cNIGHT mint logic script as a stake credential";

export function builder(yargs: Argv<GlobalOptions>) {
  return addTxOptions(
    yargs
      .option("tx-hash", {
        type: "string",
        demandOption: true,
        description: "Transaction hash for the fee-paying UTxO",
      })
      .option("tx-index", {
        type: "number",
        demandOption: true,
        description: "Transaction index for the fee-paying UTxO",
      })
      .option("output-file", {
        type: "string",
        default: "register-cnight-mint-logic-tx.json",
        description:
          "Output filename (default: register-cnight-mint-logic-tx.json)",
      })
      .option("use-build", {
        type: "boolean",
        default: false,
        description: "Use build output instead of deployed blueprint",
      }),
  );
}

export async function handler(argv: RegisterCnightMintLogicOptions) {
  const {
    network,
    output,
    "tx-hash": txHash,
    "tx-index": txIndex,
    "use-build": useBuild,
    "fee-padding": feePadding,
  } = argv;

  validateTxHash(txHash);
  validateTxIndex(txIndex);

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, argv["output-file"]);

  console.log(`\nRegistering cNIGHT mint logic script on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const contracts = getContractInstances(network, useBuild);

  if (!contracts.cnightMintLogic) {
    throw new Error(
      `cNIGHT mint logic contract not found in blueprint. Run 'just build ${network}' first.`,
    );
  }

  const cnightMintLogicHash = contracts.cnightMintLogic.Script.hash();
  console.log(`\ncNIGHT mint logic script hash: ${cnightMintLogicHash}`);

  const providerType = argv.provider;
  const { blaze, provider } = await createBlaze(network, providerType);
  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress(network);

  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`User UTXO not found: ${txHash}#${txIndex}`);
  }

  const txBuilder = blaze
    .newTransaction()
    .addInput(userUtxo)
    .provideScript(contracts.cnightMintLogic.Script)
    .addRegisterStake(
      Credential.fromCore({
        hash: cnightMintLogicHash,
        type: CredentialType.ScriptHash,
      }),
    )
    .setChangeAddress(changeAddress)
    .setFeePadding(BigInt(feePadding));

  const { tx } = await completeTx(txBuilder, {
    commandName: "register-cnight-mint-logic",
    provider,
    networkId,
    environment: network,
    knownUtxos: [userUtxo],
  });

  ensureDirectory(deploymentDir);
  writeTransactionFile(
    outputPath,
    tx.toCbor(),
    tx.getId(),
    false,
    "Register cNIGHT Mint Logic Transaction",
  );

  console.log("Transaction ID:", tx.getId());
}

const commandModule: CommandModule<
  GlobalOptions,
  RegisterCnightMintLogicOptions
> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

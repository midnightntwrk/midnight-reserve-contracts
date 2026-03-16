import type { Argv, CommandModule } from "yargs";
import { Address, PlutusData } from "@blaze-cardano/core";
import { resolve } from "path";

import type { GlobalOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { validateTxHash, validateTxIndex } from "../../lib/validation";
import { getDeployerAddress } from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import {
  getContractInstances,
  findScriptByHash,
} from "../../lib/contracts";
import {
  getTwoStageUtxos,
  parseUpgradeState,
  ensureRewardAccountsRegistered,
} from "../../lib/governance-provider";
import {
  createRewardAccount,
  findUtxoByTxRef,
} from "../../lib/transaction";
import { writeTransactionFile } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";
import { createTxMetadata } from "../../lib/metadata";

interface RunCnightMintMainnetOptions extends GlobalOptions {
  "tx-hash": string;
  "tx-index": number;
  "output-file": string;
  "use-build": boolean;
}

export const command = "run-cnight-mint-mainnet";
export const describe =
  "Run cNIGHT mint forever and logic withdrawals using two-stage as reference input";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
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
      default: "run-cnight-mint-mainnet-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use build output instead of deployed blueprint",
    });
}

export async function handler(argv: RunCnightMintMainnetOptions) {
  const {
    network,
    output,
    "tx-hash": txHash,
    "tx-index": txIndex,
    "output-file": outputFile,
    "use-build": useBuild,
  } = argv;

  validateTxHash(txHash);
  validateTxIndex(txIndex);

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(
    `\nRunning cNIGHT mint withdrawals on ${network} network`,
  );
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress(network);
  const contracts = getContractInstances(network, useBuild);

  if (
    !contracts.cnightMintTwoStage ||
    !contracts.cnightMintForever ||
    !contracts.cnightMintLogic
  ) {
    throw new Error(
      `cNIGHT minting contracts not found in blueprint. Run 'just build ${network}' first.`,
    );
  }

  const providerType = argv.provider;
  const { blaze, provider } = await createBlaze(network, providerType);

  // Query the two-stage main UTxO to read the active logic hash
  const { main: mainUtxo } = await getTwoStageUtxos(
    provider,
    contracts.cnightMintTwoStage.Script,
    networkId,
  );

  console.log("\nFound cNIGHT minting two-stage main UTxO");

  // Parse upgrade state to get the active logic and mitigation logic hashes
  const twoStageDatum = mainUtxo.output().datum()?.asInlineData();
  if (!twoStageDatum) {
    throw new Error("cNIGHT minting two-stage main UTxO missing inline datum");
  }

  const upgradeState = parseUpgradeState(twoStageDatum.toCbor());
  if (!upgradeState) {
    throw new Error(
      "Could not parse UpgradeState from cNIGHT minting two-stage datum",
    );
  }

  const { logicHash, mitigationLogicHash } = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  // Resolve the active logic script
  const logicScript = findScriptByHash(logicHash, network, useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. ` +
        `Ensure the script is in the deployed or build blueprint.`,
    );
  }

  // Resolve mitigation logic script if present
  let mitigationLogicScript: ReturnType<typeof findScriptByHash> = null;
  if (mitigationLogicHash && mitigationLogicHash !== "") {
    mitigationLogicScript = findScriptByHash(
      mitigationLogicHash,
      network,
      useBuild,
    );
    if (!mitigationLogicScript) {
      throw new Error(
        `Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`,
      );
    }
  }

  // Create reward accounts for withdrawals
  const foreverRewardAccount = createRewardAccount(
    contracts.cnightMintForever.Script.hash(),
    networkId,
  );
  const logicRewardAccount = createRewardAccount(logicHash, networkId);

  console.log("\nForever reward account:", foreverRewardAccount);
  console.log("Logic reward account:", logicRewardAccount);

  // Pre-flight: check that all withdrawal reward accounts are registered
  const accountsToCheck = [
    {
      label: "cNIGHT Mint Forever",
      rewardAccount: foreverRewardAccount,
      scriptHash: contracts.cnightMintForever.Script.hash(),
    },
    {
      label: "cNIGHT Mint Logic",
      rewardAccount: logicRewardAccount,
      scriptHash: logicHash,
    },
  ];

  let mitigationLogicRewardAccount: ReturnType<
    typeof createRewardAccount
  > | null = null;
  if (mitigationLogicScript) {
    mitigationLogicRewardAccount = createRewardAccount(
      mitigationLogicHash,
      networkId,
    );
    console.log(
      "Mitigation logic reward account:",
      mitigationLogicRewardAccount,
    );
    accountsToCheck.push({
      label: "cNIGHT Mint Mitigation Logic",
      rewardAccount: mitigationLogicRewardAccount,
      scriptHash: mitigationLogicHash,
    });
  }

  await ensureRewardAccountsRegistered(accountsToCheck, network);

  // Get fee payer UTxO
  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`User UTXO not found: ${txHash}#${txIndex}`);
  }

  const redeemer = PlutusData.newInteger(0n);

  // Build transaction:
  // - Two-stage main as reference input (forever reads it)
  // - Forever withdrawal (triggers forever_contract_withdraw)
  // - Logic withdrawal (required by forever's validate_running)
  // - Mitigation logic withdrawal if set (required by validate_running)
  const txBuilder = blaze
    .newTransaction()
    .addInput(userUtxo)
    .addReferenceInput(mainUtxo)
    .addWithdrawal(foreverRewardAccount, 0n, redeemer)
    .provideScript(contracts.cnightMintForever.Script)
    .addWithdrawal(logicRewardAccount, 0n, redeemer)
    .provideScript(logicScript)
    .setChangeAddress(changeAddress)
    .setMetadata(createTxMetadata("run-cnight-mint-mainnet"))
    .setFeePadding(50000n);

  // Add mitigation logic withdrawal if present in UpgradeState
  if (mitigationLogicScript && mitigationLogicRewardAccount) {
    console.log("  Adding mitigation logic withdrawal...");
    txBuilder
      .addWithdrawal(mitigationLogicRewardAccount, 0n, redeemer)
      .provideScript(mitigationLogicScript);
  }

  const { tx } = await completeTx(txBuilder, {
    commandName: "run-cnight-mint-mainnet",
    provider,
    networkId,
    environment: network,
    knownUtxos: [mainUtxo, userUtxo],
  });

  writeTransactionFile(
    outputPath,
    tx.toCbor(),
    tx.getId(),
    false,
    "Run cNIGHT Mint Mainnet Transaction",
  );

  console.log("\nTransaction ID:", tx.getId());
}

const commandModule: CommandModule<
  GlobalOptions,
  RunCnightMintMainnetOptions
> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

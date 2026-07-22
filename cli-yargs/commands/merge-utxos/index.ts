import type { Argv, CommandModule } from "yargs";
import {
  Address,
  PlutusData,
  TransactionOutput,
  Value,
  AssetId,
} from "@blaze-cardano/core";
import { resolve } from "path";
import type { GlobalOptions, TxOptions } from "../../lib/global-options";
import { addTxOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { validateTxHash, validateTxIndex } from "../../lib/validation";
import { getDeployerAddress, loadAikenConfig } from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import {
  getContractAddress,
  getTwoStageContracts,
  findScriptByHash,
} from "../../lib/contracts";
import {
  getContractUtxos,
  parseUpgradeState,
} from "../../lib/governance-provider";
import {
  createRewardAccount,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
} from "../../lib/transaction";
import { completeTx } from "../../lib/complete-tx";
import { writeTransactionFile } from "../../lib/output";
import { createTxMetadata } from "../../lib/metadata";

interface MergeUtxosOptions extends GlobalOptions, TxOptions {
  validator: "reserve" | "ics";
  "utxo1-hash": string;
  "utxo1-index": number;
  "utxo2-hash": string;
  "utxo2-index": number;
  "tx-hash": string;
  "tx-index": number;
  "output-file": string;
  "use-build": boolean;
}

export const command = "merge-utxos";
export const describe =
  "Merge two value-holding UTxOs at a forever validator into one";

export function builder(yargs: Argv<GlobalOptions>) {
  return addTxOptions(
    yargs
      .option("validator", {
        type: "string",
        demandOption: true,
        choices: ["reserve", "ics"] as const,
        description: "Forever validator family: reserve or ics",
      })
      .option("utxo1-hash", {
        type: "string",
        demandOption: true,
        description: "Transaction hash of the first UTxO to merge",
      })
      .option("utxo1-index", {
        type: "number",
        demandOption: true,
        description: "Output index of the first UTxO to merge",
      })
      .option("utxo2-hash", {
        type: "string",
        demandOption: true,
        description: "Transaction hash of the second UTxO to merge",
      })
      .option("utxo2-index", {
        type: "number",
        demandOption: true,
        description: "Output index of the second UTxO to merge",
      })
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
        default: "merge-utxos-tx.json",
        description: "Output file name for the transaction",
      })
      .option("use-build", {
        type: "boolean",
        default: false,
        description: "Use build output instead of deployed blueprint",
      }),
  );
}

/**
 * Merge ADA + CNIGHT values from two UTxOs using the known CNIGHT AssetId from config.
 * The on-chain validator expects exactly [Pair("", ada_tokens), Pair(cnight_policy, cnight_tokens)].
 */
function mergeValues(
  utxo1: { output(): { amount(): Value } },
  utxo2: { output(): { amount(): Value } },
  cnightAssetId: AssetId,
): Value {
  const val1 = utxo1.output().amount();
  const val2 = utxo2.output().amount();

  const totalAda = val1.coin() + val2.coin();

  const cnight1Amount = val1.multiasset()?.get(cnightAssetId) ?? 0n;
  const cnight2Amount = val2.multiasset()?.get(cnightAssetId) ?? 0n;

  if (cnight1Amount === 0n && cnight2Amount === 0n) {
    throw new Error(`Neither UTxO contains CNIGHT asset ${cnightAssetId}`);
  }

  const totalCnight = cnight1Amount + cnight2Amount;

  console.log(`  UTxO 1: ${val1.coin()} lovelace, ${cnight1Amount} CNIGHT`);
  console.log(`  UTxO 2: ${val2.coin()} lovelace, ${cnight2Amount} CNIGHT`);
  console.log(`  Merged: ${totalAda} lovelace, ${totalCnight} CNIGHT`);

  return new Value(totalAda, new Map([[cnightAssetId, totalCnight]]));
}

export async function handler(argv: MergeUtxosOptions) {
  const {
    network,
    output,
    validator,
    "utxo1-hash": utxo1Hash,
    "utxo1-index": utxo1Index,
    "utxo2-hash": utxo2Hash,
    "utxo2-index": utxo2Index,
    "tx-hash": txHash,
    "tx-index": txIndex,
    "output-file": outputFile,
    "use-build": useBuild,
    "fee-padding": feePadding,
  } = argv;

  // Validate inputs
  validateTxHash(utxo1Hash);
  validateTxIndex(utxo1Index);
  validateTxHash(utxo2Hash);
  validateTxIndex(utxo2Index);
  validateTxHash(txHash);
  validateTxIndex(txIndex);

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nMerging UTxOs on ${network} network`);
  console.log(`Validator: ${validator}`);
  console.log(`UTxO 1: ${utxo1Hash}#${utxo1Index}`);
  console.log(`UTxO 2: ${utxo2Hash}#${utxo2Index}`);
  console.log(`Fee UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress(network);
  const aikenConfig = loadAikenConfig(network);
  const cnightAssetId = AssetId(
    aikenConfig.cnight_policy +
      Buffer.from(aikenConfig.cnight_name).toString("hex"),
  );
  const { twoStage, forever, logic } = getTwoStageContracts(
    validator,
    network,
    useBuild,
  );

  const foreverAddress = getContractAddress(network, forever.Script);
  const twoStageAddress = getContractAddress(network, twoStage.Script);

  console.log("\nForever address:", foreverAddress.toBech32());
  console.log("Two-stage address:", twoStageAddress.toBech32());

  const providerType = argv.provider;
  const { blaze, provider } = await createBlaze(network, providerType);

  // Query forever and two-stage UTxOs
  const allUtxos = await getContractUtxos(
    provider,
    {
      forever: forever.Script,
      twoStage: twoStage.Script,
    },
    networkId,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Forever:", allUtxos.forever.length);
  console.log("  Two-stage:", allUtxos.twoStage.length);

  if (!allUtxos.forever.length || !allUtxos.twoStage.length) {
    throw new Error("Missing required contract UTxOs");
  }

  // Find two-stage main UTxO
  const twoStageMainUtxo = findUtxoWithMainAsset(allUtxos.twoStage);
  if (!twoStageMainUtxo) {
    throw new Error(
      `Could not find ${validator} two-stage UTxO with "main" asset`,
    );
  }

  // Find the two forever UTxOs to merge
  const utxo1 = findUtxoByTxRef(allUtxos.forever, utxo1Hash, utxo1Index);
  if (!utxo1) {
    throw new Error(`Forever UTxO 1 not found: ${utxo1Hash}#${utxo1Index}`);
  }

  const utxo2 = findUtxoByTxRef(allUtxos.forever, utxo2Hash, utxo2Index);
  if (!utxo2) {
    throw new Error(`Forever UTxO 2 not found: ${utxo2Hash}#${utxo2Index}`);
  }

  // Parse two-stage upgrade state for logic hash and logic_round
  console.log("\nReading two-stage upgrade state...");
  const twoStageDatum = twoStageMainUtxo.output().datum()?.asInlineData();
  if (!twoStageDatum) {
    throw new Error("Two-stage main UTxO missing inline datum");
  }

  const upgradeState = parseUpgradeState(twoStageDatum.toCbor());
  if (!upgradeState) {
    throw new Error("Could not parse UpgradeState from two-stage datum");
  }

  const { logicHash, mitigationLogicHash, logicRound } = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(none)");
  console.log("  Logic round:", logicRound);

  if (mitigationLogicHash) {
    throw new Error(
      `Mitigation logic is active (hash: ${mitigationLogicHash}). ` +
        `merge-utxos does not support mitigation logic — the forever contract ` +
        `requires both logic and mitigation_logic withdrawals when mitigation is set.`,
    );
  }

  const logicScript = findScriptByHash(logicHash, network, useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${logic.Script.hash()}`,
    );
  }

  const logicRewardAccount = createRewardAccount(logicHash, networkId);
  console.log("\nLogic reward account:", logicRewardAccount);

  // Find user fee UTxO
  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`Fee-paying UTxO not found: ${txHash}#${txIndex}`);
  }

  // Merge values from both UTxOs
  console.log("\nMerging values:");
  const mergedValue = mergeValues(utxo1, utxo2, cnightAssetId);

  // Preserve inline datum from utxo1
  const utxo1Datum = utxo1.output().datum();
  if (!utxo1Datum) {
    throw new Error("First UTxO missing inline datum");
  }

  // Build version-aware logic redeemer (v2 wraps in LogicRedeemer::Normal)
  const innerRedeemer = PlutusData.newInteger(0n);
  const logicRedeemer =
    logicRound >= 1 && logicScript
      ? PlutusData.fromCore({
          constructor: 0n,
          fields: { items: [innerRedeemer.toCore()] },
        })
      : innerRedeemer;

  // Build the merged output
  const mergedOutput = new TransactionOutput(foreverAddress, mergedValue);
  mergedOutput.setDatum(utxo1Datum);

  console.log("\nBuilding transaction...");

  const txBuilder = blaze
    .newTransaction()
    .addInput(utxo1, PlutusData.newInteger(0n))
    .addInput(utxo2, PlutusData.newInteger(0n))
    .addInput(userUtxo)
    .addReferenceInput(twoStageMainUtxo)
    .addWithdrawal(logicRewardAccount, 0n, logicRedeemer)
    .provideScript(forever.Script)
    .provideScript(logicScript)
    .addOutput(mergedOutput)
    .setChangeAddress(changeAddress)
    .setMetadata(createTxMetadata("merge-utxos"))
    .setFeePadding(BigInt(feePadding));

  const { tx } = await completeTx(txBuilder, {
    commandName: "merge-utxos",
    provider,
    networkId,
    environment: network,
    knownUtxos: [utxo1, utxo2, twoStageMainUtxo, userUtxo],
  });

  writeTransactionFile(
    outputPath,
    tx.toCbor(),
    tx.getId(),
    false,
    "Merge UTxOs Transaction",
  );

  console.log("\nTransaction ID:", tx.getId());
  console.log("Output file:", outputPath);
}

const commandModule: CommandModule<GlobalOptions, MergeUtxosOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;

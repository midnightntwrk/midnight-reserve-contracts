import {
  Address,
  AssetId,
  PlutusData,
  Script,
  TransactionOutput,
  PaymentAddress,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { resolve } from "path";

import type { ChangeAuthOptions } from "../lib/types";
import { getNetworkId } from "../lib/types";
import { getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import {
  getContractInstances,
  getCredentialAddress,
  findScriptByHash,
} from "../lib/contracts";
import { createFederatedOpsDatumV2 } from "../lib/candidates";
import {
  printSuccess,
  printError,
  writeTransactionFile,
  getContractUtxos,
  parseInlineDatum,
} from "../utils";
import {
  createRewardAccount,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
} from "../utils/transaction";
import { createTxMetadata } from "../utils/metadata";
import * as Contracts from "../../contract_blueprint";

export async function migrateFederatedOps(
  options: ChangeAuthOptions,
): Promise<void> {
  const { network, output, txHash, txIndex, outputFile } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(
    `\nMigrating Federated Ops datum from v1 to v2 on ${network} network`,
  );
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network, options.useBuild);

  const federatedOpsForeverAddress = getCredentialAddress(
    network,
    contracts.federatedOpsForever.Script.hash(),
  );

  console.log(
    "\nFederated Ops Forever Address:",
    federatedOpsForeverAddress.toBech32(),
  );

  const { blaze, provider } = await createBlaze(network, options.provider);

  // Query all contract UTxOs in parallel
  const allUtxos = await getContractUtxos(
    provider,
    {
      federatedOpsForever: contracts.federatedOpsForever.Script,
      federatedOpsTwoStage: contracts.federatedOpsTwoStage.Script,
    },
    networkId,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Federated ops forever:", allUtxos.federatedOpsForever.length);
  console.log(
    "  Federated ops two stage:",
    allUtxos.federatedOpsTwoStage.length,
  );

  if (
    !allUtxos.federatedOpsForever.length ||
    !allUtxos.federatedOpsTwoStage.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const federatedOpsForeverUtxo = allUtxos.federatedOpsForever[0];
  const federatedOpsTwoStageUtxo = findUtxoWithMainAsset(
    allUtxos.federatedOpsTwoStage,
  );

  if (!federatedOpsTwoStageUtxo) {
    throw new Error(
      'Could not find federated ops two-stage UTxO with "main" asset',
    );
  }

  console.log("\nReading federated ops two-stage upgrade state...");
  const upgradeState = parseInlineDatum(
    federatedOpsTwoStageUtxo,
    Contracts.UpgradeState,
    parse,
  );
  const [logicHash, mitigationLogicHash] = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  // Check that the active logic is NOT the v1 logic (migration requires v2 logic to be promoted)
  const v1LogicHash = contracts.federatedOpsLogic.Script.hash();
  if (logicHash === v1LogicHash) {
    throw new Error(
      `Active logic is still v1 (${logicHash}). Migration requires v2 logic to be promoted. Run promote-upgrade first.`,
    );
  }

  const logicScript = findScriptByHash(logicHash, network, options.useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected a known federated ops logic script.`,
    );
  }

  let mitigationLogicScript: Script | null = null;
  if (mitigationLogicHash && mitigationLogicHash !== "") {
    mitigationLogicScript = findScriptByHash(
      mitigationLogicHash,
      network,
      options.useBuild,
    );
    if (!mitigationLogicScript) {
      throw new Error(
        `Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`,
      );
    }
  }

  // Read current v1 datum as raw PlutusData
  console.log("\nCurrent federated ops forever datum:");
  const foreverDatum = federatedOpsForeverUtxo.output().datum();
  if (!foreverDatum?.asInlineData()) {
    throw new Error("Federated ops forever UTxO missing inline datum");
  }
  const currentDatumRaw = foreverDatum.asInlineData()!;

  // Guard: check if datum is already v2 (4 elements instead of 3)
  const datumList = currentDatumRaw.asList();
  if (datumList && datumList.getLength() >= 4) {
    throw new Error(
      "Federated ops datum already has 4+ elements (already FederatedOpsV2). Migration is not needed.",
    );
  }

  // Also parse with typed schema to log info
  const currentFederatedOpsState = parse(
    Contracts.FederatedOps,
    currentDatumRaw,
  );
  const currentLogicRound = currentFederatedOpsState[2];
  console.log("  Current logic round:", currentLogicRound);
  console.log("  Appendix entries:", currentFederatedOpsState[1].length);

  // Build FederatedOpsV2 datum from existing v1 datum
  const newDatum = createFederatedOpsDatumV2(currentDatumRaw);
  console.log("\nNew FederatedOpsV2 datum created:");
  console.log("  message: (empty)");
  console.log("  logic_round: 2");

  const logicRewardAccount = createRewardAccount(logicHash, networkId);
  console.log("\nLogic reward account:", logicRewardAccount);

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
  }

  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`User UTXO not found: ${txHash}#${txIndex}`);
  }

  // Migrate redeemer: constructor variant index 1 (Migrate), empty fields
  const migrateRedeemer = PlutusData.fromCore({
    constructor: 1n,
    fields: { items: [] },
  });

  try {
    const txBuilder = blaze
      .newTransaction()
      .addInput(userUtxo)
      .addInput(federatedOpsForeverUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(federatedOpsTwoStageUtxo)
      .provideScript(contracts.federatedOpsForever.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(federatedOpsForeverAddress.toBech32()),
          value: {
            coins: federatedOpsForeverUtxo.output().amount().coin(),
            assets: new Map([
              [AssetId(contracts.federatedOpsForever.Script.hash()), 1n],
            ]),
          },
          datum: newDatum.toCore(),
        }),
      )
      // Add logic withdrawal with Migrate redeemer
      .addWithdrawal(logicRewardAccount, 0n, migrateRedeemer)
      .provideScript(logicScript)
      .setChangeAddress(changeAddress)
      .setMetadata(createTxMetadata("migrate-federated-ops"))
      .setFeePadding(50000n);

    // Add mitigation logic withdrawal if present in UpgradeState
    if (mitigationLogicScript && mitigationLogicRewardAccount) {
      console.log("  Adding mitigation logic withdrawal...");
      txBuilder
        .addWithdrawal(mitigationLogicRewardAccount, 0n, migrateRedeemer)
        .provideScript(mitigationLogicScript);
    }

    const tx = await txBuilder.complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Migrate Federated Ops Transaction",
    );
    printSuccess(`Transaction written to ${outputPath}`);

    console.log("\nTransaction ID:", tx.getId());
    console.log(
      "\nNote: Migrate redeemer bypasses multisig validation - no signing required.",
    );
  } catch (error) {
    printError("Transaction build failed");
    // Log detailed error info
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      if ("cause" in error && error.cause) {
        console.error("Error cause:", JSON.stringify(error.cause, null, 2));
      }
    }
    console.error(error);
    throw error;
  }
}

import type { Argv, CommandModule } from "yargs";
import { parse } from "@blaze-cardano/data";
import {
  Address,
  AssetId,
  PlutusData,
  Script,
  TransactionOutput,
  PaymentAddress,
} from "@blaze-cardano/core";
import { resolve } from "path";
import type { GlobalOptions, TxOptions } from "../../lib/global-options";
import { addTxOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { validateTxHash, validateTxIndex } from "../../lib/validation";
import { getDeployerAddress } from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import {
  getContractInstances,
  getContractAddress,
  findScriptByHash,
} from "../../lib/contracts";
import {
  getContractUtxos,
  parseUpgradeState,
  ensureRewardAccountsRegistered,
} from "../../lib/governance-provider";
import { createFederatedOpsDatumV2 } from "../../lib/candidates";
import {
  createRewardAccount,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
} from "../../lib/transaction";
import { writeTransactionFile } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";
import { createTxMetadata } from "../../lib/metadata";
import * as Contracts from "../../../contract_blueprint";

interface MigrateFederatedOpsOptions extends GlobalOptions, TxOptions {
  "tx-hash": string;
  "tx-index": number;
  "output-file": string;
  "use-build": boolean;
}

export const command = "migrate-federated-ops";
export const describe = "Migrate federated ops datum from v1 to v2";

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
        default: "migrate-federated-ops-tx.json",
        description: "Output file name for the transaction",
      })
      .option("use-build", {
        type: "boolean",
        default: false,
        description: "Use build output instead of deployed blueprint",
      }),
  );
}

export async function handler(argv: MigrateFederatedOpsOptions) {
  const {
    network,
    output,
    "tx-hash": txHash,
    "tx-index": txIndex,
    "output-file": outputFile,
    "use-build": useBuild,
    "fee-padding": feePadding,
  } = argv;

  validateTxHash(txHash);
  validateTxIndex(txIndex);

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(
    `\nMigrating Federated Ops datum from v1 to v2 on ${network} network`,
  );
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress(network);
  const contracts = getContractInstances(network, useBuild);

  const federatedOpsForeverAddress = getContractAddress(
    network,
    contracts.federatedOpsForever.Script,
  );

  console.log(
    "\nFederated Ops Forever Address:",
    federatedOpsForeverAddress.toBech32(),
  );

  const providerType = argv.provider;
  const { blaze, provider } = await createBlaze(network, providerType);

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

  // Parse federated ops two-stage upgrade state
  console.log("\nReading federated ops two-stage upgrade state...");
  const twoStageDatum = federatedOpsTwoStageUtxo
    .output()
    .datum()
    ?.asInlineData();
  if (!twoStageDatum) {
    throw new Error("Federated ops two-stage UTxO missing inline datum");
  }

  const upgradeState = parseUpgradeState(twoStageDatum.toCbor());
  if (!upgradeState) {
    throw new Error(
      "Could not parse UpgradeState from federated ops two-stage datum",
    );
  }

  const { logicHash, mitigationLogicHash } = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  // Check that the active logic is NOT the v1 logic (migration requires v2 logic to be promoted)
  const v1LogicHash = contracts.federatedOpsLogic.Script.hash();
  if (logicHash === v1LogicHash) {
    throw new Error(
      `Active logic is still v1 (${logicHash}). Migration requires v2 logic to be promoted. Run promote-upgrade first.`,
    );
  }

  const logicScript = findScriptByHash(logicHash, network, useBuild);
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
      useBuild,
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

  // Pre-flight: check that all withdrawal reward accounts are registered
  const accountsToCheck = [
    {
      label: "Logic (v2)",
      rewardAccount: logicRewardAccount,
      scriptHash: logicHash,
    },
  ];
  if (mitigationLogicRewardAccount) {
    accountsToCheck.push({
      label: "Mitigation Logic",
      rewardAccount: mitigationLogicRewardAccount,
      scriptHash: mitigationLogicHash,
    });
  }
  await ensureRewardAccountsRegistered(accountsToCheck, network);

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
    .setFeePadding(BigInt(feePadding));

  // Add mitigation logic withdrawal if present in UpgradeState
  if (mitigationLogicScript && mitigationLogicRewardAccount) {
    console.log("  Adding mitigation logic withdrawal...");
    txBuilder
      .addWithdrawal(mitigationLogicRewardAccount, 0n, migrateRedeemer)
      .provideScript(mitigationLogicScript);
  }

  const { tx } = await completeTx(txBuilder, {
    commandName: "migrate-federated-ops",
    provider,
    networkId,
    environment: network,
    knownUtxos: [federatedOpsForeverUtxo, federatedOpsTwoStageUtxo, userUtxo],
  });

  writeTransactionFile(
    outputPath,
    tx.toCbor(),
    tx.getId(),
    false,
    "Migrate Federated Ops Transaction",
  );

  console.log("\nTransaction ID:", tx.getId());
  console.log(
    "\nNote: Migrate redeemer bypasses multisig validation - no signing required.",
  );
}

const commandModule: CommandModule<GlobalOptions, MigrateFederatedOpsOptions> =
  {
    command,
    describe,
    builder,
    handler,
  };

export default commandModule;

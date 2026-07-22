/**
 * Shared engine for change-council and change-tech-auth commands.
 *
 * Both commands follow the same flow:
 *   1. Query contract UTxOs
 *   2. Parse primary two-stage upgrade state (logic hash, logic_round)
 *   3. Decode primary forever datum (version-aware)
 *   4. Extract secondary signers (for ML-3 validation)
 *   5. Build new state, redeemer, threshold, native multisig scripts
 *   6. Build and complete the transaction
 *
 * The config captures the differences between the two commands.
 */
import { parse } from "@blaze-cardano/data";
import {
  Address,
  AssetId,
  AssetName,
  PlutusData,
  PolicyId,
  Script,
  TransactionOutput,
  TransactionUnspentOutput,
  PaymentAddress,
} from "@blaze-cardano/core";
import { resolve } from "path";
import type { GlobalOptions, TxOptions } from "./global-options";
import type { Signer } from "./types";
import { getNetworkId } from "./types";
import { getDeployerAddress } from "./config";
import { createBlaze } from "./provider";
import {
  getContractInstances,
  getContractAddress,
  findScriptByHash,
} from "./contracts";
import type { ContractInstances } from "./contracts";
import { getContractUtxos, parseUpgradeState } from "./governance-provider";
import { parseSigners, createRedeemerMapCbor } from "./signers";
import {
  createNativeMultisigScript,
  createRewardAccount,
  signAndWriteTx,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
  parseInlineDatum,
} from "./transaction";
import { completeTx } from "./complete-tx";
import { createTxMetadata } from "./metadata";
import { getDatumHandler } from "./datum-versions";
import { validateTxHash, validateTxIndex } from "./validation";
import * as Contracts from "../../contract_blueprint";

interface ContractRef {
  Script: Script;
}

export interface MultisigChangeConfig {
  /** Command name for metadata and logging (e.g. "change-council") */
  commandName: string;
  /** Human label for logging (e.g. "Council") */
  commandLabel: string;
  /** Description for signAndWriteTx (e.g. "Change Council Transaction") */
  signDescription: string;

  /** Datum family for version-aware decode ("council" | "tech-auth") */
  primaryFamily: "council" | "tech-auth";
  /** Env var holding new signers (e.g. "COUNCIL_SIGNERS") */
  signerEnvVar: string;

  /**
   * Select contracts from the loaded ContractInstances.
   * Returns the primary/secondary contracts and any extras to query.
   */
  getContracts(contracts: ContractInstances): {
    primaryForever: ContractRef;
    primaryTwoStage: ContractRef;
    primaryThreshold: ContractRef;
    primaryLogic: ContractRef;
    secondaryForever: ContractRef;
    /** Additional contracts to query beyond the core 4 */
    extraContracts?: Record<string, Script>;
  };

  /**
   * Extract secondary signers from queried UTxOs.
   * change-council: raw extractSignersFromCbor on tech-auth forever
   * change-tech-auth: version-aware via council two-stage logicRound
   */
  getSecondarySigners(
    allUtxos: Record<string, TransactionUnspentOutput[]>,
  ): Signer[];
}

interface MultisigChangeOptions extends GlobalOptions, TxOptions {
  "tx-hash": string;
  "tx-index": number;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export async function buildMultisigChangeTx(
  config: MultisigChangeConfig,
  argv: MultisigChangeOptions,
) {
  const {
    network,
    output,
    sign,
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
    `\nChanging ${config.commandLabel} members on ${network} network`,
  );
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress(network);
  const contracts = getContractInstances(network, useBuild);

  const selected = config.getContracts(contracts);
  const primaryForeverAddress = getContractAddress(
    network,
    selected.primaryForever.Script,
  );

  console.log(
    `\n${config.commandLabel} Forever Address:`,
    primaryForeverAddress.toBech32(),
  );

  const providerType = argv.provider;
  const { blaze, provider } = await createBlaze(network, providerType);

  // Build contract query map: primary forever, threshold, secondary forever, primary two-stage + extras
  const contractQueryMap: Record<string, Script> = {
    primaryForever: selected.primaryForever.Script,
    primaryThreshold: selected.primaryThreshold.Script,
    secondaryForever: selected.secondaryForever.Script,
    primaryTwoStage: selected.primaryTwoStage.Script,
    ...selected.extraContracts,
  };

  const allUtxos = await getContractUtxos(
    provider,
    contractQueryMap,
    networkId,
  );

  console.log("\nFound contract UTxOs:");
  for (const [name, utxos] of Object.entries(allUtxos)) {
    console.log(`  ${name}:`, utxos.length);
  }

  // Validate required UTxOs exist
  const requiredKeys = [
    "primaryForever",
    "primaryThreshold",
    "secondaryForever",
    "primaryTwoStage",
  ];
  for (const key of requiredKeys) {
    if (!allUtxos[key]?.length) {
      throw new Error(`Missing required contract UTxOs: ${key}`);
    }
  }

  const primaryForeverUtxo = allUtxos.primaryForever[0];
  const primaryThresholdUtxo = allUtxos.primaryThreshold[0];
  const secondaryForeverUtxo = allUtxos.secondaryForever[0];
  const primaryTwoStageUtxo = findUtxoWithMainAsset(allUtxos.primaryTwoStage);

  if (!primaryTwoStageUtxo) {
    throw new Error(
      `Could not find ${config.commandLabel.toLowerCase()} two-stage UTxO with "main" asset`,
    );
  }

  // Parse two-stage upgrade state — source of truth for logic hash and logic_round
  console.log(
    `\nReading ${config.commandLabel.toLowerCase()} two-stage upgrade state...`,
  );
  const twoStageDatum = primaryTwoStageUtxo.output().datum()?.asInlineData();
  if (!twoStageDatum) {
    throw new Error(
      `${config.commandLabel} two-stage UTxO missing inline datum`,
    );
  }

  const upgradeState = parseUpgradeState(twoStageDatum.toCbor());
  if (!upgradeState) {
    throw new Error(
      `Could not parse UpgradeState from ${config.commandLabel.toLowerCase()} two-stage datum`,
    );
  }

  const { logicHash, mitigationLogicHash, logicRound } = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");
  console.log("  Logic round:", logicRound);

  const logicScript = findScriptByHash(logicHash, network, useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${selected.primaryLogic.Script.hash()}`,
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

  // Version-aware datum handling — logicRound from two-stage state drives version selection
  console.log(
    `\nDecoding ${config.commandLabel.toLowerCase()} forever datum (version-aware)...`,
  );
  const foreverDatum = primaryForeverUtxo.output().datum()?.asInlineData();
  if (!foreverDatum) {
    throw new Error(`${config.commandLabel} forever UTxO missing inline datum`);
  }

  const datumHandler = getDatumHandler(config.primaryFamily, logicRound);
  const currentData = datumHandler.decode(foreverDatum);
  const currentPrimarySigners = currentData.signers;

  if (!currentPrimarySigners.length) {
    throw new Error(
      `No ${config.commandLabel.toLowerCase()} signers found in forever datum`,
    );
  }

  // Parse current secondary state for ML-3 validation
  console.log("\nReading current secondary state for ML-3 validation...");
  const secondarySigners = config.getSecondarySigners(allUtxos);

  if (!secondarySigners.length) {
    throw new Error("No secondary signers found for ML-3 validation");
  }

  // Build new state using version-aware handler
  const newSigners = parseSigners(config.signerEnvVar);
  const newData = {
    totalSigners: BigInt(newSigners.length),
    signers: newSigners,
  };
  const newForeverStateCbor = datumHandler.encode(newData);

  const innerRedeemerCbor = createRedeemerMapCbor(newSigners);
  // Wrap in LogicRedeemer::Normal(inner) for v2 logic scripts, plain for v1
  const memberRedeemerCbor =
    logicRound >= 1 && logicScript
      ? PlutusData.fromCore({
          constructor: 0n,
          fields: { items: [innerRedeemerCbor.toCore()] },
        })
      : innerRedeemerCbor;

  console.log(
    `New ${config.commandLabel.toLowerCase()} signers count:`,
    newSigners.length,
  );
  console.log(
    "  Unique payment hashes:",
    new Set(newSigners.map((s) => s.paymentHash)).size,
  );

  // Read threshold datum
  console.log(
    `\nReading ${config.commandLabel.toLowerCase()} update threshold...`,
  );
  const thresholdState = parseInlineDatum(
    primaryThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

  // MultisigThreshold is a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
  // The "primary" threshold uses the primary signers count, "secondary" uses secondary signers count.
  // Which fraction applies to which group depends on the domain:
  //   - For change-council: tech_auth is secondary (fraction indices 0,1), council is primary (fraction indices 2,3)
  //   - For change-tech-auth: tech_auth is primary (fraction indices 0,1), council is secondary (fraction indices 2,3)
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

  let primaryRequiredSigners: number;
  let secondaryRequiredSigners: number;
  let primarySignerLabel: string;
  let secondarySignerLabel: string;

  if (config.primaryFamily === "council") {
    // Primary = council (indices 2,3), Secondary = tech-auth (indices 0,1)
    primaryRequiredSigners = Number(
      (BigInt(currentPrimarySigners.length) * councilNum +
        (councilDenom - 1n)) /
        councilDenom,
    );
    secondaryRequiredSigners = Number(
      (BigInt(secondarySigners.length) * techAuthNum + (techAuthDenom - 1n)) /
        techAuthDenom,
    );
    primarySignerLabel = "council";
    secondarySignerLabel = "tech auth";
  } else {
    // Primary = tech-auth (indices 0,1), Secondary = council (indices 2,3)
    primaryRequiredSigners = Number(
      (BigInt(currentPrimarySigners.length) * techAuthNum +
        (techAuthDenom - 1n)) /
        techAuthDenom,
    );
    secondaryRequiredSigners = Number(
      (BigInt(secondarySigners.length) * councilNum + (councilDenom - 1n)) /
        councilDenom,
    );
    primarySignerLabel = "tech auth";
    secondarySignerLabel = "council";
  }

  console.log(
    `\nRequired ${primarySignerLabel} signers: ${primaryRequiredSigners}/${currentPrimarySigners.length}`,
  );
  console.log(
    `Required ${secondarySignerLabel} signers: ${secondaryRequiredSigners}/${secondarySigners.length}`,
  );

  const nativeScriptPrimary = createNativeMultisigScript(
    primaryRequiredSigners,
    currentPrimarySigners,
    networkId,
  );

  const nativeScriptSecondary = createNativeMultisigScript(
    secondaryRequiredSigners,
    secondarySigners,
    networkId,
  );

  const primaryPolicyId = PolicyId(nativeScriptPrimary.hash());
  const secondaryPolicyId = PolicyId(nativeScriptSecondary.hash());

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

  // Build transaction
  // Mint order: in the original code, change-council mints council first then tech-auth,
  // and change-tech-auth mints tech-auth first then council. Primary always first.
  const txBuilder = blaze
    .newTransaction()
    .addInput(userUtxo)
    .addInput(primaryForeverUtxo, PlutusData.newInteger(0n))
    .addReferenceInput(primaryThresholdUtxo)
    .addReferenceInput(secondaryForeverUtxo)
    .addReferenceInput(primaryTwoStageUtxo)
    .provideScript(selected.primaryForever.Script)
    .addMint(primaryPolicyId, new Map([[AssetName(""), 1n]]))
    .provideScript(Script.newNativeScript(nativeScriptPrimary))
    .addMint(secondaryPolicyId, new Map([[AssetName(""), 1n]]))
    .provideScript(Script.newNativeScript(nativeScriptSecondary))
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(primaryForeverAddress.toBech32()),
        value: {
          coins: primaryForeverUtxo.output().amount().coin(),
          assets: new Map([
            [AssetId(selected.primaryForever.Script.hash()), 1n],
          ]),
        },
        datum: newForeverStateCbor.toCore(),
      }),
    )
    .addWithdrawal(logicRewardAccount, 0n, memberRedeemerCbor)
    .provideScript(logicScript)
    .setChangeAddress(changeAddress)
    .setMetadata(createTxMetadata(config.commandName))
    .setFeePadding(BigInt(feePadding));

  // Add mitigation logic withdrawal if present in UpgradeState
  if (mitigationLogicScript && mitigationLogicRewardAccount) {
    console.log("  Adding mitigation logic withdrawal...");
    txBuilder
      .addWithdrawal(mitigationLogicRewardAccount, 0n, memberRedeemerCbor)
      .provideScript(mitigationLogicScript);
  }

  // knownUtxos: primary forever, threshold, secondary forever, primary two-stage, user
  // (matches both original commands — neither includes extra query-only UTxOs)
  const { tx } = await completeTx(txBuilder, {
    commandName: config.commandName,
    provider,
    networkId,
    environment: network,
    knownUtxos: [
      primaryForeverUtxo,
      primaryThresholdUtxo,
      secondaryForeverUtxo,
      primaryTwoStageUtxo,
      userUtxo,
    ],
  });

  signAndWriteTx(tx, outputPath, sign, config.signDescription);
}

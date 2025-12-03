import {
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  HexBlob,
  PaymentAddress,
  PlutusData,
  PolicyId,
  Script,
  toHex,
  TransactionOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { resolve } from "path";

import type { DeployOptions, TransactionOutput as TxOutput } from "../lib/types";
import { getNetworkId } from "../lib/types";
import { loadAikenConfig, getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import { getContractInstances } from "../lib/contracts";
import {
  parseSignersWithCount,
  createMultisigStateFromMap,
} from "../lib/signers";
import {
  writeJsonFile,
  createDeploymentOutput,
  printSuccess,
  printError,
  printProgress,
  printTransactionSummary,
  ensureDirectory,
} from "../utils/output";
import { createOneShotUtxo, createUpgradeState } from "../utils/transaction";
import * as Contracts from "../../contract_blueprint";

interface MultisigDeployParams {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  twoStageContract: { Script: Script };
  foreverContract: { Script: Script };
  logicContract: { Script: Script };
  totalSigners: bigint;
  signers: Record<string, string>;
}

interface SimpleDeployParams {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  twoStageContract: { Script: Script };
  foreverContract: { Script: Script };
  logicContract: { Script: Script };
}

interface ThresholdDeployParams {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  thresholdContract: { Script: Script };
  thresholdDatum: Contracts.MultisigThreshold;
}

export async function deploy(options: DeployOptions): Promise<void> {
  const {
    network,
    output,
    utxoAmount,
    outputAmount,
    thresholdOutputAmount,
    techAuthThreshold,
    councilThreshold,
    stagingThreshold,
    components,
  } = options;

  console.log(`===========================================`);
  console.log(`Generating deployment transactions for ${network}`);
  console.log(`===========================================`);
  console.log(`UTxO Amount: ${utxoAmount} lovelace`);
  console.log(`Output Amount: ${outputAmount} lovelace`);
  console.log(`Threshold Output Amount: ${thresholdOutputAmount} lovelace`);

  // Load configuration
  const config = loadAikenConfig(network);
  const contracts = getContractInstances();
  const networkId = getNetworkId(network);
  const deployerAddr = getDeployerAddress();

  // Parse signers
  const { totalSigners: techAuthTotalSigners, signers: techAuthSigners } =
    parseSignersWithCount("TECH_AUTH_SIGNERS");
  const { totalSigners: councilTotalSigners, signers: councilSigners } =
    parseSignersWithCount("COUNCIL_SIGNERS");

  console.log(`\nTotal tech auth signers: ${techAuthTotalSigners}`);
  console.log(`Number of tech auth signer pairs: ${Object.keys(techAuthSigners).length}`);
  console.log(`Total council signers: ${councilTotalSigners}`);
  console.log(`Number of council signer pairs: ${Object.keys(councilSigners).length}`);

  // Create Blaze instance
  const { blaze } = await createBlaze(network, options.provider);

  // Helper functions
  async function generateMultisigDeployment(params: MultisigDeployParams) {
    printProgress(`Generating ${params.name} deployment transaction...`);

    const oneShotUtxo = createOneShotUtxo(
      params.oneShotHash,
      params.oneShotIndex,
      deployerAddr,
      utxoAmount,
    );

    const twoStageAddress = addressFromValidator(networkId, params.twoStageContract.Script);
    const foreverAddress = addressFromValidator(networkId, params.foreverContract.Script);

    const upgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.govAuth.Script.hash(),
    );

    const foreverState = createMultisigStateFromMap(params.totalSigners, params.signers);

    let txBuilder = blaze.newTransaction().addInput(oneShotUtxo);

    // Add mints
    txBuilder = txBuilder
      .addMint(
        PolicyId(params.foreverContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        serialize(Contracts.PermissionedRedeemer, params.signers),
      )
      .addMint(
        PolicyId(params.twoStageContract.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(params.twoStageContract.Script)
      .provideScript(params.foreverContract.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([
              [
                AssetId(
                  params.twoStageContract.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([
              [
                AssetId(
                  params.twoStageContract.Script.hash() +
                    toHex(new TextEncoder().encode("staging")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(foreverAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([[AssetId(params.foreverContract.Script.hash()), 1n]]),
          },
          datum: serialize(Contracts.Multisig, foreverState).toCore(),
        }),
      )
      .addRegisterStake(
        Credential.fromCore({
          hash: params.logicContract.Script.hash(),
          type: CredentialType.ScriptHash,
        }),
      );

    return await txBuilder.complete();
  }

  async function generateSimpleDeployment(params: SimpleDeployParams) {
    printProgress(`Generating ${params.name} deployment transaction...`);

    const oneShotUtxo = createOneShotUtxo(
      params.oneShotHash,
      params.oneShotIndex,
      deployerAddr,
      utxoAmount,
    );

    const foreverAddress = addressFromValidator(networkId, params.foreverContract.Script);
    const twoStageAddress = addressFromValidator(networkId, params.twoStageContract.Script);

    const upgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.govAuth.Script.hash(),
    );

    const tx = await blaze
      .newTransaction()
      .addInput(oneShotUtxo)
      .addMint(
        PolicyId(params.foreverContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .addMint(
        PolicyId(params.twoStageContract.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(params.foreverContract.Script)
      .provideScript(params.twoStageContract.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([
              [
                AssetId(
                  params.twoStageContract.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([
              [
                AssetId(
                  params.twoStageContract.Script.hash() +
                    toHex(new TextEncoder().encode("staging")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(foreverAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([[AssetId(params.foreverContract.Script.hash()), 1n]]),
          },
          datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
        }),
      )
      .complete();

    return tx;
  }

  async function generateThresholdDeployment(params: ThresholdDeployParams) {
    printProgress(`Generating ${params.name} deployment transaction...`);

    const oneShotUtxo = createOneShotUtxo(
      params.oneShotHash,
      params.oneShotIndex,
      deployerAddr,
      utxoAmount,
    );

    const thresholdAddress = addressFromValidator(networkId, params.thresholdContract.Script);

    const tx = await blaze
      .newTransaction()
      .addInput(oneShotUtxo)
      .addMint(
        PolicyId(params.thresholdContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(params.thresholdContract.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(thresholdAddress.toBech32()),
          value: {
            coins: thresholdOutputAmount,
            assets: new Map([[AssetId(params.thresholdContract.Script.hash()), 1n]]),
          },
          datum: serialize(Contracts.MultisigThreshold, params.thresholdDatum).toCore(),
        }),
      )
      .complete();

    return tx;
  }

  // Define all transactions
  const allTransactionDefs = [
    {
      name: "technical-authority-deployment",
      component: "tech-auth",
      generator: () =>
        generateMultisigDeployment({
          name: "Technical Authority",
          oneShotHash: config.technical_authority_one_shot_hash,
          oneShotIndex: config.technical_authority_one_shot_index,
          twoStageContract: contracts.techAuthTwoStage,
          foreverContract: contracts.techAuthForever,
          logicContract: contracts.techAuthLogic,
          totalSigners: techAuthTotalSigners,
          signers: techAuthSigners,
        }),
    },
    {
      name: "tech-auth-update-threshold-deployment",
      component: "tech-auth-threshold",
      generator: () =>
        generateThresholdDeployment({
          name: "Tech Auth Update Threshold",
          oneShotHash: config.main_tech_auth_update_one_shot_hash,
          oneShotIndex: config.main_tech_auth_update_one_shot_index,
          thresholdContract: contracts.mainTechAuthUpdateThreshold,
          thresholdDatum: {
            technical_auth_numerator: techAuthThreshold.numerator,
            technical_auth_denominator: techAuthThreshold.denominator,
            council_numerator: councilThreshold.numerator,
            council_denominator: councilThreshold.denominator,
          },
        }),
    },
    {
      name: "council-deployment",
      component: "council",
      generator: () =>
        generateMultisigDeployment({
          name: "Council",
          oneShotHash: config.council_one_shot_hash,
          oneShotIndex: config.council_one_shot_index,
          twoStageContract: contracts.councilTwoStage,
          foreverContract: contracts.councilForever,
          logicContract: contracts.councilLogic,
          totalSigners: councilTotalSigners,
          signers: councilSigners,
        }),
    },
    {
      name: "council-update-threshold-deployment",
      component: "council-threshold",
      generator: () =>
        generateThresholdDeployment({
          name: "Council Update Threshold",
          oneShotHash: config.main_council_update_one_shot_hash,
          oneShotIndex: config.main_council_update_one_shot_index,
          thresholdContract: contracts.mainCouncilUpdateThreshold,
          thresholdDatum: {
            technical_auth_numerator: techAuthThreshold.numerator,
            technical_auth_denominator: techAuthThreshold.denominator,
            council_numerator: councilThreshold.numerator,
            council_denominator: councilThreshold.denominator,
          },
        }),
    },
    {
      name: "reserve-deployment",
      component: "reserve",
      generator: () =>
        generateSimpleDeployment({
          name: "Reserve",
          oneShotHash: config.reserve_one_shot_hash,
          oneShotIndex: config.reserve_one_shot_index,
          twoStageContract: contracts.reserveTwoStage,
          foreverContract: contracts.reserveForever,
          logicContract: contracts.reserveLogic,
        }),
    },
    {
      name: "ics-deployment",
      component: "ics",
      generator: () =>
        generateSimpleDeployment({
          name: "ICS",
          oneShotHash: config.ics_one_shot_hash,
          oneShotIndex: config.ics_one_shot_index,
          twoStageContract: contracts.icsTwoStage,
          foreverContract: contracts.icsForever,
          logicContract: contracts.icsLogic,
        }),
    },
    {
      name: "main-gov-threshold-deployment",
      component: "main-gov",
      generator: () =>
        generateThresholdDeployment({
          name: "Main Government Threshold",
          oneShotHash: config.main_gov_one_shot_hash,
          oneShotIndex: config.main_gov_one_shot_index,
          thresholdContract: contracts.mainGovThreshold,
          thresholdDatum: {
            technical_auth_numerator: techAuthThreshold.numerator,
            technical_auth_denominator: techAuthThreshold.denominator,
            council_numerator: councilThreshold.numerator,
            council_denominator: councilThreshold.denominator,
          },
        }),
    },
    {
      name: "staging-gov-threshold-deployment",
      component: "staging-gov",
      generator: () =>
        generateThresholdDeployment({
          name: "Staging Government Threshold",
          oneShotHash: config.staging_gov_one_shot_hash,
          oneShotIndex: config.staging_gov_one_shot_index,
          thresholdContract: contracts.stagingGovThreshold,
          thresholdDatum: {
            technical_auth_numerator: stagingThreshold.numerator,
            technical_auth_denominator: stagingThreshold.denominator,
            council_numerator: stagingThreshold.numerator,
            council_denominator: stagingThreshold.denominator,
          },
        }),
    },
    {
      name: "federated-ops-deployment",
      component: "federated-ops",
      generator: () =>
        generateMultisigDeployment({
          name: "Federated Operators",
          oneShotHash: config.federated_operators_one_shot_hash,
          oneShotIndex: config.federated_operators_one_shot_index,
          twoStageContract: contracts.federatedOpsTwoStage,
          foreverContract: contracts.federatedOpsForever,
          logicContract: contracts.federatedOpsLogic,
          totalSigners: councilTotalSigners,
          signers: councilSigners,
        }),
    },
    {
      name: "federated-ops-update-threshold-deployment",
      component: "federated-ops-threshold",
      generator: () =>
        generateThresholdDeployment({
          name: "Federated Ops Update Threshold",
          oneShotHash: config.main_federated_ops_update_one_shot_hash,
          oneShotIndex: config.main_federated_ops_update_one_shot_index,
          thresholdContract: contracts.mainFederatedOpsUpdateThreshold,
          thresholdDatum: {
            technical_auth_numerator: techAuthThreshold.numerator,
            technical_auth_denominator: techAuthThreshold.denominator,
            council_numerator: councilThreshold.numerator,
            council_denominator: councilThreshold.denominator,
          },
        }),
    },
  ];

  // Filter transactions based on components
  const transactions =
    components.length === 0 || components.includes("all")
      ? allTransactionDefs
      : allTransactionDefs.filter((t) => components.includes(t.component));

  // Generate transactions
  const allTransactions: TxOutput[] = [];

  for (const { name, generator } of transactions) {
    try {
      const tx = await generator();
      allTransactions.push({
        name,
        cbor: tx.toCbor(),
        hash: tx.getId(),
      });
    } catch (error) {
      printError(`Error generating ${name}: ${error}`);
      throw error;
    }
  }

  // Save output
  const deploymentDir = resolve(output, network);
  ensureDirectory(deploymentDir);

  const outputFile = resolve(deploymentDir, "deployment-transactions.json");
  const deploymentOutput = createDeploymentOutput(
    network,
    { utxoAmount, outputAmount, thresholdOutputAmount },
    allTransactions,
  );

  writeJsonFile(outputFile, deploymentOutput);

  console.log(`===========================================`);
  printSuccess(`Generated ${transactions.length} deployment transactions`);
  console.log(`Output file: ${outputFile}`);
  console.log(`===========================================`);

  printTransactionSummary(allTransactions);
}

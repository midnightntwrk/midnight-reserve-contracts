import type { Argv, CommandModule } from "yargs";
import {
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  PaymentAddress,
  PlutusData,
  PolicyId,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  toHex,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { calculateRequiredCollateral } from "@blaze-cardano/tx";
import { existsSync } from "fs";
import { resolve } from "path";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";

import type { GlobalOptions } from "../../lib/global-options";
import type { TransactionOutput as TxOutput } from "../../lib/types";
import { getNetworkId } from "../../lib/types";
import {
  loadAikenConfig,
  getDeployerAddress,
  getDeployUtxoAmount,
} from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import { getProtocolParameters, calculateMinUtxo } from "../../lib/protocol";
import { getContractInstances } from "../../lib/contracts";
import {
  writeJsonFile,
  createDeploymentOutput,
  printSuccess,
  printError,
  printInfo,
  printTransactionSummary,
  ensureDirectory,
  TX_TYPE_CONWAY,
} from "../../lib/output";
import { createOneShotUtxo, createUpgradeState } from "../../lib/transaction";
import { saveVersionSnapshot, type ChangeRecord } from "../../lib/versions";
import * as Contracts from "../../../contract_blueprint";

interface DeployCnightMintingOptions extends GlobalOptions {
  "utxo-amount"?: string;
}

export const command = "deploy-cnight-minting";
export const describe = "Deploy cNIGHT minting two-stage upgrade contracts";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs.option("utxo-amount", {
    type: "string",
    description:
      "Lovelace amount per UTxO (default: from DEPLOY_UTXO_AMOUNT env or 20000000)",
  });
}

export async function handler(argv: DeployCnightMintingOptions) {
  const { network, output } = argv;

  const utxoAmount = argv["utxo-amount"]
    ? BigInt(argv["utxo-amount"])
    : getDeployUtxoAmount();

  console.log(`===========================================`);
  console.log(`Generating cNIGHT minting deployment for ${network}`);
  console.log(`===========================================`);
  console.log(`UTxO Amount: ${utxoAmount} lovelace`);

  const config = loadAikenConfig(network);
  // Always use build blueprint — cNIGHT minting contracts are not in deployed-scripts
  const contracts = getContractInstances(network, true);
  if (
    !contracts.cnightMintTwoStage ||
    !contracts.cnightMintForever ||
    !contracts.cnightMintLogic
  ) {
    throw new Error(
      `cNIGHT minting contracts not found in blueprint. Run 'just build ${network}' first.`,
    );
  }
  const networkId = getNetworkId(network);
  const deployerAddr = getDeployerAddress();

  const { blaze } = await createBlaze(network, argv.provider);
  const protocolParams = await getProtocolParameters(blaze.provider);

  // Resolve collateral if configured
  let collateralUtxo: TransactionUnspentOutput | undefined;
  if (config.collateral_utxo_hash) {
    const collateralInput = TransactionInput.fromCore({
      txId: TransactionId(config.collateral_utxo_hash),
      index: config.collateral_utxo_index,
    });
    const resolved = await blaze.provider.resolveUnspentOutputs([
      collateralInput,
    ]);
    if (resolved.length > 0) {
      collateralUtxo = resolved[0];
      console.log(
        `\nUsing collateral UTxO: ${config.collateral_utxo_hash}#${config.collateral_utxo_index} with ${collateralUtxo.output().amount().coin()} lovelace`,
      );

      const estimatedMaxFee = 5_000_000n;
      const requiredCollateral = calculateRequiredCollateral(
        estimatedMaxFee,
        protocolParams.collateralPercentage,
      );
      const availableCollateral = collateralUtxo.output().amount().coin();

      if (availableCollateral < requiredCollateral) {
        throw new Error(
          `Collateral UTxO has ${availableCollateral} lovelace but requires at least ${requiredCollateral} lovelace`,
        );
      }
      console.log(
        `Collateral validation passed: ${availableCollateral} lovelace >= ${requiredCollateral} lovelace required`,
      );
    } else {
      throw new Error(
        `Collateral UTxO not found: ${config.collateral_utxo_hash}#${config.collateral_utxo_index}`,
      );
    }
  }

  // Build one-shot UTxO in-memory (same pattern as deploy command)
  const oneShotUtxo = createOneShotUtxo(
    config.cnight_minting_one_shot_hash,
    config.cnight_minting_one_shot_index,
    deployerAddr,
    utxoAmount,
  );

  const twoStageAddress = addressFromValidator(
    networkId,
    contracts.cnightMintTwoStage.Script,
  );

  // UpgradeState datums: logic = always-fails (cnightMintLogic), auth = govAuth/stagingGovAuth
  const mainUpgradeState = createUpgradeState(
    contracts.cnightMintLogic.Script.hash(),
    contracts.govAuth.Script.hash(),
  );
  const stagingUpgradeState = createUpgradeState(
    contracts.cnightMintLogic.Script.hash(),
    contracts.stagingGovAuth.Script.hash(),
  );

  // Two-stage main output with "main" NFT
  const twoStageMainOutput = TransactionOutput.fromCore({
    address: PaymentAddress(twoStageAddress.toBech32()),
    value: {
      coins: 0n,
      assets: new Map([
        [
          AssetId(
            contracts.cnightMintTwoStage.Script.hash() +
              toHex(new TextEncoder().encode("main")),
          ),
          1n,
        ],
      ]),
    },
    datum: serialize(Contracts.UpgradeState, mainUpgradeState).toCore(),
  });
  twoStageMainOutput
    .amount()
    .setCoin(calculateMinUtxo(protocolParams, twoStageMainOutput));

  // Two-stage staging output with "staging" NFT
  const twoStageStagingOutput = TransactionOutput.fromCore({
    address: PaymentAddress(twoStageAddress.toBech32()),
    value: {
      coins: 0n,
      assets: new Map([
        [
          AssetId(
            contracts.cnightMintTwoStage.Script.hash() +
              toHex(new TextEncoder().encode("staging")),
          ),
          1n,
        ],
      ]),
    },
    datum: serialize(Contracts.UpgradeState, stagingUpgradeState).toCore(),
  });
  twoStageStagingOutput
    .amount()
    .setCoin(calculateMinUtxo(protocolParams, twoStageStagingOutput));

  // Build transaction:
  // - Consume one-shot UTxO
  // - Mint "main" + "staging" NFTs under two-stage policy
  // - Output main and staging NFTs to two-stage address
  // - Register cnightMintForever as stake credential
  // - NO forever NFT mint/output (unlike other deploy commands)
  let txBuilder = blaze
    .newTransaction()
    .addInput(oneShotUtxo)
    .addMint(
      PolicyId(contracts.cnightMintTwoStage.Script.hash()),
      new Map([
        [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
        [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
      ]),
      PlutusData.newInteger(0n),
    )
    .provideScript(contracts.cnightMintTwoStage.Script)
    .addOutput(twoStageMainOutput)
    .addOutput(twoStageStagingOutput)
    .addRegisterStake(
      Credential.fromCore({
        hash: contracts.cnightMintForever.Script.hash(),
        type: CredentialType.ScriptHash,
      }),
    );

  if (collateralUtxo) {
    txBuilder = txBuilder.provideCollateral([collateralUtxo]);
  }

  try {
    const tx = await txBuilder.complete();

    const transactions: TxOutput[] = [
      {
        type: TX_TYPE_CONWAY,
        description: "cnight-minting-deployment",
        cborHex: tx.toCbor(),
        txHash: tx.getId(),
        signed: false,
      },
    ];

    const deploymentDir = resolve(output, network);
    ensureDirectory(deploymentDir);

    const outputFile = resolve(deploymentDir, "cnight-minting-deployment.json");
    const deploymentOutput = createDeploymentOutput(
      network,
      { utxoAmount },
      transactions,
    );

    writeJsonFile(outputFile, deploymentOutput);

    // Merge cNIGHT minting validators into deployed-scripts and update versions.json
    try {
      const projectRoot = resolve(import.meta.dir, "../../..");
      const plutusJsonPath = resolve(projectRoot, `plutus-${network}.json`);
      const blueprintPath = resolve(
        projectRoot,
        `contract_blueprint_${network}.ts`,
      );

      if (existsSync(plutusJsonPath) && existsSync(blueprintPath)) {
        const changes: ChangeRecord[] = [
          {
            type: "initial",
            validator: "cnight-minting",
            description: "cNIGHT minting deployment",
          },
        ];

        saveVersionSnapshot(
          network,
          {
            round: 0n,
            logicRound: 0n,
            timestamp: new Date().toISOString(),
            gitCommit: "",
          },
          changes,
          plutusJsonPath,
          blueprintPath,
        );

        printSuccess(`Merged cNIGHT minting into deployed-scripts/${network}/`);
      }
    } catch (error) {
      printInfo(
        `Note: Could not update deployed-scripts: ${error instanceof Error ? error.message : error}`,
      );
    }

    console.log(`===========================================`);
    printSuccess(`Generated cNIGHT minting deployment transaction`);
    console.log(`Output file: ${outputFile}`);
    console.log(`===========================================`);

    printTransactionSummary(transactions);
  } catch (error) {
    printError(`Error generating cNIGHT minting deployment: ${error}`);
    throw error;
  }
}

const commandModule: CommandModule<GlobalOptions, DeployCnightMintingOptions> =
  {
    command,
    describe,
    builder,
    handler,
  };

export default commandModule;

#!/usr/bin/env bun

import {
  Address,
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  fromHex,
  HexBlob,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  Script,
  toHex,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Blaze, ColdWallet, Core } from "@blaze-cardano/sdk";
import { Blockfrost } from "@blaze-cardano/query";
import * as Contracts from "./contract_blueprint";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import * as toml from "toml";

// Get network from command line arguments
const network = process.argv[2] || "preview";

// Validate network parameter
if (!["preview", "preprod", "mainnet"].includes(network)) {
  console.error(
    "Error: Invalid network. Use 'preview', 'preprod', or 'mainnet'",
  );
  process.exit(1);
}

console.log(`Generating deployment transactions for ${network} network...`);

// Create deployment output directory
const deploymentDir = resolve("./deployments", network);
if (!existsSync(deploymentDir)) {
  mkdirSync(deploymentDir, { recursive: true });
}

// Load config from aiken.toml
const aikenToml = readFileSync("aiken.toml", "utf-8");
const parsedToml = toml.parse(aikenToml);
const networkConfig = parsedToml.config[network];

const config = {
  technical_authority_one_shot_hash:
    networkConfig.technical_authority_one_shot_hash.bytes,
  technical_authority_one_shot_index:
    networkConfig.technical_authority_one_shot_index,
  council_one_shot_hash: networkConfig.council_one_shot_hash.bytes,
  council_one_shot_index: networkConfig.council_one_shot_index,
  reserve_one_shot_hash: networkConfig.reserve_one_shot_hash.bytes,
  reserve_one_shot_index: networkConfig.reserve_one_shot_index,
  ics_one_shot_hash: networkConfig.ics_one_shot_hash.bytes,
  ics_one_shot_index: networkConfig.ics_one_shot_index,
  federated_operators_one_shot_hash:
    networkConfig.federated_operators_one_shot_hash.bytes,
  federated_operators_one_shot_index:
    networkConfig.federated_operators_one_shot_index,
  main_gov_one_shot_hash: networkConfig.main_gov_one_shot_hash.bytes,
  main_gov_one_shot_index: networkConfig.main_gov_one_shot_index,
  staging_gov_one_shot_hash: networkConfig.staging_gov_one_shot_hash.bytes,
  staging_gov_one_shot_index: networkConfig.staging_gov_one_shot_index,
  main_council_update_one_shot_hash:
    networkConfig.main_council_update_one_shot_hash.bytes,
  main_council_update_one_shot_index:
    networkConfig.main_council_update_one_shot_index,
  main_tech_auth_update_one_shot_hash:
    networkConfig.main_tech_auth_update_one_shot_hash.bytes,
  main_tech_auth_update_one_shot_index:
    networkConfig.main_tech_auth_update_one_shot_index,
  main_federated_ops_update_one_shot_hash:
    networkConfig.main_federated_ops_update_one_shot_hash.bytes,
  main_federated_ops_update_one_shot_index:
    networkConfig.main_federated_ops_update_one_shot_index,
};

// Contract instances
const techAuthTwoStage =
  new Contracts.PermissionedTechAuthTwoStageUpgradeElse();
const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
const techAuthLogic = new Contracts.PermissionedTechAuthLogicElse();
const councilTwoStage = new Contracts.PermissionedCouncilTwoStageUpgradeElse();
const councilForever = new Contracts.PermissionedCouncilForeverElse();
const councilLogic = new Contracts.PermissionedCouncilLogicElse();
const reserveForever = new Contracts.ReserveReserveForeverElse();
const reserveTwoStage = new Contracts.ReserveReserveTwoStageUpgradeElse();
const reserveLogic = new Contracts.ReserveReserveLogicElse();
const govAuth = new Contracts.GovAuthMainGovAuthElse();
const icsForever = new Contracts.IliquidCirculationSupplyIcsForeverElse();
const icsTwoStage =
  new Contracts.IliquidCirculationSupplyIcsTwoStageUpgradeElse();
const icsLogic = new Contracts.IliquidCirculationSupplyIcsLogicElse();
const federatedOpsForever = new Contracts.PermissionedFederatedOpsForeverElse();
const federatedOpsTwoStage =
  new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse();
const federatedOpsLogic = new Contracts.PermissionedFederatedOpsLogicElse();
const mainGovThreshold = new Contracts.ThresholdsMainGovThresholdElse();
const stagingGovThreshold = new Contracts.ThresholdsStagingGovThresholdElse();
const mainCouncilUpdateThreshold =
  new Contracts.ThresholdsMainCouncilUpdateThresholdElse();
const mainTechAuthUpdateThreshold =
  new Contracts.ThresholdsMainTechAuthUpdateThresholdElse();
const mainFederatedOpsUpdateThreshold =
  new Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse();

// Network ID mapping
const networkIdMap: Record<string, NetworkId> = {
  preview: NetworkId.Testnet,
  preprod: NetworkId.Testnet,
  mainnet: NetworkId.Mainnet,
};

const networkId = networkIdMap[network];

// Blockfrost API setup
const getBlockfrostProvider = () => {
  const apiKeyVar = `BLOCKFROST_${network.toUpperCase()}_API_KEY`;
  const apiKey = process.env[apiKeyVar];

  if (!apiKey) {
    console.error(`Error: ${apiKeyVar} environment variable is required.`);
    console.error("Set your Blockfrost API key:");
    console.error(`export ${apiKeyVar}=your_api_key_here`);
    process.exit(1);
  }

  const networkName =
    network === "mainnet"
      ? "cardano-mainnet"
      : network === "preview"
        ? "cardano-preview"
        : "cardano-preprod";

  return new Blockfrost({ network: networkName, projectId: apiKey });
};

// Initialize Blaze with Blockfrost provider
const provider = getBlockfrostProvider();

// Store all transactions for single output file
const allTransactions: Array<{
  name: string;
  cbor: string;
  hash: string;
}> = [];

// Helper function to get deployer address from environment or use default
const getDeployerAddress = (): string => {
  const deployerAddr = process.env.DEPLOYER_ADDRESS;
  if (deployerAddr) {
    return deployerAddr;
  }

  return "addr_test1qruhen60uwzpwnnr7gjs50z2v8u9zyfw6zunet4k42zrpr54mrlv55f93rs6j48wt29w90hlxt4rvpvshe55k5r9mpvqjv2wt4";
};

// Helper function to parse signers from environment
const parseSigners = (
  techAuthSigner: boolean,
): {
  totalSigners: bigint;
  signers: { [x: string]: string };
} => {
  let signersEnv: string | undefined;
  if (techAuthSigner) {
    signersEnv = process.env.TECH_AUTH_SIGNERS;
  } else {
    signersEnv = process.env.COUNCIL_SIGNERS;
  }

  if (!signersEnv) {
    console.error("Error: SIGNERS environment variable is required.");
    console.error("Set this in your .env file:");
    console.error(
      "SIGNERS=cardano_key_hash1:sr25519_key1,cardano_key_hash2:sr25519_key2",
    );
    process.exit(1);
  }

  const signers: { [x: string]: string } = {};

  const signerPairs = signersEnv.split(",");
  for (const pair of signerPairs) {
    const [paymentHash, stakeHash] = pair.trim().split(":");
    if (paymentHash && stakeHash) {
      signers[paymentHash] = stakeHash;
    }
  }

  console.log(signerPairs);

  const totalSigners = BigInt(Object.keys(signers).length);

  return { totalSigners, signers };
};

// Helper function to create multisig state with CBOR-prefixed credentials
const createMultisigState = (
  totalSigners: bigint,
  signers: { [x: string]: string },
): Contracts.Multisig => {
  // Add CBOR prefix "8200581c" to each key for Multisig state
  const prefixedSigners: { [x: string]: string } = {};
  for (const [hash, sr25519Key] of Object.entries(signers)) {
    prefixedSigners["8200581c" + hash] = sr25519Key;
  }
  return [totalSigners, prefixedSigners];
};

// Consolidated function for tech_auth, council, and federated_ops deployments
async function generateMultisigDeployment(params: {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  twoStageContract: { Script: Script };
  foreverContract: { Script: Script };
  logicContract: { Script: Script };
  totalSigners: bigint;
  signers: { [x: string]: string };
}) {
  console.log(`Generating ${params.name} deployment transaction...`);

  const blaze = await Blaze.from(
    provider,
    new ColdWallet(
      Address.fromBech32(getDeployerAddress()),
      network === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet,
      provider,
    ),
  );
  const deployerAddr = getDeployerAddress();

  try {
    const oneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: params.oneShotIndex,
        txId: TransactionId(params.oneShotHash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const twoStageAddress = addressFromValidator(
      networkId,
      params.twoStageContract.Script,
    );
    const foreverAddress = addressFromValidator(
      networkId,
      params.foreverContract.Script,
    );

    const upgradeState: Contracts.UpgradeState = [
      params.logicContract.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
    ];

    const foreverState = createMultisigState(
      params.totalSigners,
      params.signers,
    );

    let txBuilder = blaze.newTransaction().addInput(oneShotUtxo);

    // Add two-stage mint
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
            coins: 1_000_000n,
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
            coins: 1_000_000n,
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
            coins: 1_000_000n,
            assets: new Map([
              [AssetId(params.foreverContract.Script.hash()), 1n],
            ]),
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

    const tx = await txBuilder.complete();
    return tx;
  } catch (error) {
    console.error(`Error generating ${params.name} deployment:`, error);
    throw error;
  }
}

// Consolidated function for ICS and Reserve deployments
async function generateSimpleDeployment(params: {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  twoStageContract: { Script: Script };
  foreverContract: { Script: Script };
  logicContract: { Script: Script };
}) {
  console.log(`Generating ${params.name} deployment transaction...`);

  const blaze = await Blaze.from(
    provider,
    new ColdWallet(
      Address.fromBech32(getDeployerAddress()),
      network === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet,
      provider,
    ),
  );
  const deployerAddr = getDeployerAddress();

  try {
    const oneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: params.oneShotIndex,
        txId: TransactionId(params.oneShotHash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const foreverAddress = addressFromValidator(
      networkId,
      params.foreverContract.Script,
    );
    const twoStageAddress = addressFromValidator(
      networkId,
      params.twoStageContract.Script,
    );

    const upgradeState: Contracts.UpgradeState = [
      params.logicContract.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
    ];

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
            coins: 1_000_000n,
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
            coins: 1_000_000n,
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
            coins: 1_000_000n,
            assets: new Map([
              [AssetId(params.foreverContract.Script.hash()), 1n],
            ]),
          },
          datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error(`Error generating ${params.name} deployment:`, error);
    throw error;
  }
}

// Consolidated function for threshold deployments
async function generateThresholdDeployment(params: {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  thresholdContract: { Script: Script };
  thresholdDatum: Contracts.MultisigThreshold;
}) {
  console.log(`Generating ${params.name} deployment transaction...`);

  const blaze = await Blaze.from(
    provider,
    new ColdWallet(
      Address.fromBech32(getDeployerAddress()),
      network === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet,
      provider,
    ),
  );
  const deployerAddr = getDeployerAddress();

  try {
    const oneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: params.oneShotIndex,
        txId: TransactionId(params.oneShotHash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const thresholdAddress = addressFromValidator(
      networkId,
      params.thresholdContract.Script,
    );

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
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(params.thresholdContract.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            params.thresholdDatum,
          ).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error(`Error generating ${params.name} deployment:`, error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    console.log(`===========================================`);
    console.log(`Generating deployment transactions for ${network}`);
    console.log(`===========================================`);

    // Parse signers from environment
    const { totalSigners: techAuthTotalSigners, signers: techAuthSigners } =
      parseSigners(true);

    // Parse signers from environment
    const { totalSigners: councilTotalSigners, signers: councilSigners } =
      parseSigners(true);

    console.log(`Total tech auth signers: ${techAuthTotalSigners}`);
    console.log(
      `Number of tech auth signer pairs: ${Object.keys(techAuthSigners).length}`,
    );
    console.log(`Total council signers: ${councilTotalSigners}`);
    console.log(
      `Number of council signer pairs: ${Object.keys(councilSigners).length}`,
    );

    // Generate all deployment transactions
    const transactions = [
      {
        name: "technical-authority-deployment",
        generator: () =>
          generateMultisigDeployment({
            name: "Technical Authority",
            oneShotHash: config.technical_authority_one_shot_hash,
            oneShotIndex: config.technical_authority_one_shot_index,
            twoStageContract: techAuthTwoStage,
            foreverContract: techAuthForever,
            logicContract: techAuthLogic,
            totalSigners: techAuthTotalSigners,
            signers: techAuthSigners,
          }),
      },
      {
        name: "council-deployment",
        generator: () =>
          generateMultisigDeployment({
            name: "Council",
            oneShotHash: config.council_one_shot_hash,
            oneShotIndex: config.council_one_shot_index,
            twoStageContract: councilTwoStage,
            foreverContract: councilForever,
            logicContract: councilLogic,
            totalSigners: councilTotalSigners,
            signers: councilSigners,
          }),
      },
      {
        name: "federated-ops-deployment",
        generator: () =>
          generateMultisigDeployment({
            name: "Federated Operators",
            oneShotHash: config.federated_operators_one_shot_hash,
            oneShotIndex: config.federated_operators_one_shot_index,
            twoStageContract: federatedOpsTwoStage,
            foreverContract: federatedOpsForever,
            logicContract: federatedOpsLogic,
            totalSigners: councilTotalSigners,
            signers: councilSigners,
          }),
      },
      {
        name: "reserve-deployment",
        generator: () =>
          generateSimpleDeployment({
            name: "Reserve",
            oneShotHash: config.reserve_one_shot_hash,
            oneShotIndex: config.reserve_one_shot_index,
            twoStageContract: reserveTwoStage,
            foreverContract: reserveForever,
            logicContract: reserveLogic,
          }),
      },
      {
        name: "ics-deployment",
        generator: () =>
          generateSimpleDeployment({
            name: "ICS",
            oneShotHash: config.ics_one_shot_hash,
            oneShotIndex: config.ics_one_shot_index,
            twoStageContract: icsTwoStage,
            foreverContract: icsForever,
            logicContract: icsLogic,
          }),
      },
      {
        name: "main-gov-threshold-deployment",
        generator: () =>
          generateThresholdDeployment({
            name: "Main Government Threshold",
            oneShotHash: config.main_gov_one_shot_hash,
            oneShotIndex: config.main_gov_one_shot_index,
            thresholdContract: mainGovThreshold,
            thresholdDatum: {
              technical_auth_numerator: 2n,
              technical_auth_denominator: 3n,
              council_numerator: 2n,
              council_denominator: 3n,
            },
          }),
      },
      {
        name: "staging-gov-threshold-deployment",
        generator: () =>
          generateThresholdDeployment({
            name: "Staging Government Threshold",
            oneShotHash: config.staging_gov_one_shot_hash,
            oneShotIndex: config.staging_gov_one_shot_index,
            thresholdContract: stagingGovThreshold,
            thresholdDatum: {
              technical_auth_numerator: 1n,
              technical_auth_denominator: 2n,
              council_numerator: 1n,
              council_denominator: 2n,
            },
          }),
      },
      {
        name: "council-update-threshold-deployment",
        generator: () =>
          generateThresholdDeployment({
            name: "Council Update Threshold",
            oneShotHash: config.main_council_update_one_shot_hash,
            oneShotIndex: config.main_council_update_one_shot_index,
            thresholdContract: mainCouncilUpdateThreshold,
            thresholdDatum: {
              technical_auth_numerator: 1n,
              technical_auth_denominator: 3n,
              council_numerator: 2n,
              council_denominator: 3n,
            },
          }),
      },
      {
        name: "tech-auth-update-threshold-deployment",
        generator: () =>
          generateThresholdDeployment({
            name: "Tech Auth Update Threshold",
            oneShotHash: config.main_tech_auth_update_one_shot_hash,
            oneShotIndex: config.main_tech_auth_update_one_shot_index,
            thresholdContract: mainTechAuthUpdateThreshold,
            thresholdDatum: {
              technical_auth_numerator: 2n,
              technical_auth_denominator: 3n,
              council_numerator: 2n,
              council_denominator: 3n,
            },
          }),
      },
      {
        name: "federated-ops-update-threshold-deployment",
        generator: () =>
          generateThresholdDeployment({
            name: "Federated Ops Update Threshold",
            oneShotHash: config.main_federated_ops_update_one_shot_hash,
            oneShotIndex: config.main_federated_ops_update_one_shot_index,
            thresholdContract: mainFederatedOpsUpdateThreshold,
            thresholdDatum: {
              technical_auth_numerator: 2n,
              technical_auth_denominator: 3n,
              council_numerator: 2n,
              council_denominator: 3n,
            },
          }),
      },
    ];

    // Generate each transaction and add to collection
    for (const { name, generator } of transactions) {
      console.log(`Generating ${name}...`);
      const tx = await generator();
      allTransactions.push({
        name,
        cbor: tx.toCbor(),
        hash: tx.getId(),
      });
    }

    // Save all transactions to single file
    const outputFile = resolve(deploymentDir, "deployment-transactions.json");
    const output = {
      network,
      timestamp: new Date().toISOString(),
      transactions: allTransactions,
    };

    // Custom JSON replacer to handle BigInt values
    const jsonReplacer = (key: string, value: any) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    };

    writeFileSync(outputFile, JSON.stringify(output, jsonReplacer, 2));

    console.log(`===========================================`);
    console.log(
      `Successfully generated ${transactions.length} deployment transactions`,
    );
    console.log(`Output file: ${outputFile}`);
    console.log(`===========================================`);

    console.log(`\nTransaction Summary:`);
    allTransactions.forEach((tx, index) => {
      console.log(`${index + 1}. ${tx.name}`);
      console.log(`   Hash: ${tx.hash}`);
      console.log(``);
    });
  } catch (error) {
    console.error("Error generating deployment transactions:", error);
    process.exit(1);
  }
}

main();

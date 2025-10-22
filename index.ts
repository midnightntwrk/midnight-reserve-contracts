#!/usr/bin/env bun

import {
  Address,
  addressFromValidator,
  AssetId,
  AssetName,
  fromHex,
  HexBlob,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
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

// Helper function to create multisig state with real credentials
const createMultisigState = (totalSigners: bigint): Contracts.Multisig => {
  const deployerAddr = getDeployerAddress();
  const addr = Core.addressFromBech32(deployerAddr);

  if (!addr.asBase()) {
    throw new Error(
      "Deployer address must be a Base address with payment and stake credentials",
    );
  }

  return [
    totalSigners,
    PlutusData.fromCore({
      items: [
        fromHex("8200581c" + addr.asBase()!.getPaymentCredential().hash),
        fromHex("8200581c" + addr.asBase()!.getStakeCredential().hash),
      ],
    }),
  ];
};

// Transaction 1: Technical Authority Deployment
async function generateTechAuthDeployment() {
  console.log("Generating Technical Authority deployment transaction...");

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
    // Create one-shot UTxO from config
    const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.technical_authority_one_shot_index,
        txId: TransactionId(config.technical_authority_one_shot_hash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const techAuthTwoStageAddress = addressFromValidator(
      networkId,
      techAuthTwoStage.Script,
    );
    const techAuthForeverAddress = addressFromValidator(
      networkId,
      techAuthForever.Script,
    );

    const techAuthUpgradeState: Contracts.UpgradeState = [
      techAuthLogic.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
    ];

    const techAuthForeverState = createMultisigState(2n);

    // Build real transaction with Blaze
    const tx = await blaze
      .newTransaction()
      .addInput(techAuthOneShotUtxo)
      .addMint(
        PolicyId(techAuthForever.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.fromCore({
          items: [
            fromHex(
              Core.addressFromBech32(deployerAddr)
                .asBase()!
                .getPaymentCredential().hash,
            ),
            fromHex(
              Core.addressFromBech32(deployerAddr)
                .asBase()!
                .getStakeCredential().hash,
            ),
          ],
        }),
      )
      .addMint(
        PolicyId(techAuthTwoStage.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(techAuthTwoStage.Script)
      .provideScript(techAuthForever.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  techAuthTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            techAuthUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  techAuthTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("staging")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            techAuthUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(techAuthForeverAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(techAuthForever.Script.hash()), 1n]]),
          },
          datum: serialize(Contracts.Multisig, techAuthForeverState).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error("Error generating Technical Authority deployment:", error);
    throw error;
  }
}

// Transaction 2: Council Deployment
async function generateCouncilDeployment() {
  console.log("Generating Council deployment transaction...");

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
    const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.council_one_shot_index,
        txId: TransactionId(config.council_one_shot_hash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const councilTwoStageAddress = addressFromValidator(
      networkId,
      councilTwoStage.Script,
    );
    const councilForeverAddress = addressFromValidator(
      networkId,
      councilForever.Script,
    );

    const councilUpgradeState: Contracts.UpgradeState = [
      councilLogic.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
    ];

    const councilForeverState = createMultisigState(2n);

    const tx = await blaze
      .newTransaction()
      .addInput(councilOneShotUtxo)
      .addMint(
        PolicyId(councilForever.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.fromCore({
          items: [
            fromHex(
              Core.addressFromBech32(deployerAddr)
                .asBase()!
                .getPaymentCredential().hash,
            ),
            fromHex(
              Core.addressFromBech32(deployerAddr)
                .asBase()!
                .getStakeCredential().hash,
            ),
          ],
        }),
      )
      .addMint(
        PolicyId(councilTwoStage.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(councilTwoStage.Script)
      .provideScript(councilForever.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(councilTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  councilTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            councilUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(councilTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  councilTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("staging")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            councilUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(councilForeverAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(councilForever.Script.hash()), 1n]]),
          },
          datum: serialize(Contracts.Multisig, councilForeverState).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error("Error generating Council deployment:", error);
    throw error;
  }
}

// Transaction 3: Reserve Deployment
async function generateReserveDeployment() {
  console.log("Generating Reserve deployment transaction...");

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
    const reserveOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.reserve_one_shot_index,
        txId: TransactionId(config.reserve_one_shot_hash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const reserveForeverAddress = addressFromValidator(
      networkId,
      reserveForever.Script,
    );
    const reserveTwoStageAddress = addressFromValidator(
      networkId,
      reserveTwoStage.Script,
    );

    const reserveUpgradeState: Contracts.UpgradeState = [
      reserveLogic.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
    ];

    const tx = await blaze
      .newTransaction()
      .addInput(reserveOneShotUtxo)
      .addMint(
        PolicyId(reserveForever.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .addMint(
        PolicyId(reserveTwoStage.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(reserveForever.Script)
      .provideScript(reserveTwoStage.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(reserveTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  reserveTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            reserveUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(reserveTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  reserveTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("staging")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            reserveUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(reserveForeverAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(reserveForever.Script.hash()), 1n]]),
          },
          datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error("Error generating Reserve deployment:", error);
    throw error;
  }
}

// Transaction 4: ICS Deployment
async function generateIcsDeployment() {
  console.log("Generating ICS deployment transaction...");

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
    const icsOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.ics_one_shot_index,
        txId: TransactionId(config.ics_one_shot_hash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const icsForeverAddress = addressFromValidator(
      networkId,
      icsForever.Script,
    );
    const icsTwoStageAddress = addressFromValidator(
      networkId,
      icsTwoStage.Script,
    );

    const icsUpgradeState: Contracts.UpgradeState = [
      icsLogic.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
    ];

    const tx = await blaze
      .newTransaction()
      .addInput(icsOneShotUtxo)
      .addMint(
        PolicyId(icsForever.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .addMint(
        PolicyId(icsTwoStage.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(icsForever.Script)
      .provideScript(icsTwoStage.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(icsTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  icsTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, icsUpgradeState).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(icsTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  icsTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("staging")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, icsUpgradeState).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(icsForeverAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(icsForever.Script.hash()), 1n]]),
          },
          datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error("Error generating ICS deployment:", error);
    throw error;
  }
}

// Transaction 5: Federated Operators Deployment
async function generateFederatedOpsDeployment() {
  console.log("Generating Federated Operators deployment transaction...");

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
    const federatedOpsOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.federated_operators_one_shot_index,
        txId: TransactionId(config.federated_operators_one_shot_hash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const federatedOpsForeverAddress = addressFromValidator(
      networkId,
      federatedOpsForever.Script,
    );
    const federatedOpsTwoStageAddress = addressFromValidator(
      networkId,
      federatedOpsTwoStage.Script,
    );

    const federatedOpsUpgradeState: Contracts.UpgradeState = [
      federatedOpsLogic.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
    ];

    const federatedOpsForeverState = createMultisigState(2n);

    const tx = await blaze
      .newTransaction()
      .addInput(federatedOpsOneShotUtxo)
      .addMint(
        PolicyId(federatedOpsForever.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.fromCore({
          items: [
            fromHex(
              Core.addressFromBech32(deployerAddr)
                .asBase()!
                .getPaymentCredential().hash,
            ),
            fromHex(
              Core.addressFromBech32(deployerAddr)
                .asBase()!
                .getStakeCredential().hash,
            ),
          ],
        }),
      )
      .addMint(
        PolicyId(federatedOpsTwoStage.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(federatedOpsForever.Script)
      .provideScript(federatedOpsTwoStage.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  federatedOpsTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            federatedOpsUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  federatedOpsTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("staging")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            federatedOpsUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(federatedOpsForeverAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(federatedOpsForever.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.Multisig,
            federatedOpsForeverState,
          ).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error("Error generating Federated Operators deployment:", error);
    throw error;
  }
}

// Transaction 6: Main Government Threshold Deployment
async function generateMainGovThresholdDeployment() {
  console.log("Generating Main Government Threshold deployment transaction...");

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
    const mainGovThresholdOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.main_gov_one_shot_index,
        txId: TransactionId(config.main_gov_one_shot_hash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const mainGovThresholdAddress = addressFromValidator(
      networkId,
      mainGovThreshold.Script,
    );

    const thresholdDatum: Contracts.MultisigThreshold = {
      technical_auth_numerator: 2n,
      technical_auth_denominator: 3n,
      council_numerator: 2n,
      council_denominator: 3n,
    };

    const tx = await blaze
      .newTransaction()
      .addInput(mainGovThresholdOneShotUtxo)
      .addMint(
        PolicyId(mainGovThreshold.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(mainGovThreshold.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(mainGovThresholdAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(mainGovThreshold.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            thresholdDatum,
          ).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error(
      "Error generating Main Government Threshold deployment:",
      error,
    );
    throw error;
  }
}

// Transaction 7: Staging Government Threshold Deployment
async function generateStagingGovThresholdDeployment() {
  console.log(
    "Generating Staging Government Threshold deployment transaction...",
  );

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
    const stagingGovThresholdOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.staging_gov_one_shot_index,
        txId: TransactionId(config.staging_gov_one_shot_hash),
      },
      {
        address: PaymentAddress(deployerAddr),
        value: {
          coins: 100_000_000n,
        },
      },
    ]);

    const stagingGovThresholdAddress = addressFromValidator(
      networkId,
      stagingGovThreshold.Script,
    );

    const thresholdDatum: Contracts.MultisigThreshold = {
      technical_auth_numerator: 1n,
      technical_auth_denominator: 2n,
      council_numerator: 1n,
      council_denominator: 2n,
    };

    const tx = await blaze
      .newTransaction()
      .addInput(stagingGovThresholdOneShotUtxo)
      .addMint(
        PolicyId(stagingGovThreshold.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(stagingGovThreshold.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(stagingGovThresholdAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(stagingGovThreshold.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            thresholdDatum,
          ).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error(
      "Error generating Staging Government Threshold deployment:",
      error,
    );
    throw error;
  }
}

// Transaction 8: Council Update Threshold Deployment
async function generateCouncilUpdateThresholdDeployment() {
  console.log("Generating Council Update Threshold deployment transaction...");

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
    const councilUpdateThresholdOneShotUtxo = TransactionUnspentOutput.fromCore(
      [
        {
          index: config.main_council_update_one_shot_index,
          txId: TransactionId(config.main_council_update_one_shot_hash),
        },
        {
          address: PaymentAddress(deployerAddr),
          value: {
            coins: 100_000_000n,
          },
        },
      ],
    );

    const councilUpdateThresholdAddress = addressFromValidator(
      networkId,
      mainCouncilUpdateThreshold.Script,
    );

    const thresholdDatum: Contracts.MultisigThreshold = {
      technical_auth_numerator: 2n,
      technical_auth_denominator: 3n,
      council_numerator: 2n,
      council_denominator: 3n,
    };

    const tx = await blaze
      .newTransaction()
      .addInput(councilUpdateThresholdOneShotUtxo)
      .addMint(
        PolicyId(mainCouncilUpdateThreshold.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(mainCouncilUpdateThreshold.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(councilUpdateThresholdAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            thresholdDatum,
          ).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error(
      "Error generating Council Update Threshold deployment:",
      error,
    );
    throw error;
  }
}

// Transaction 9: Tech Auth Update Threshold Deployment
async function generateTechAuthUpdateThresholdDeployment() {
  console.log(
    "Generating Tech Auth Update Threshold deployment transaction...",
  );

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
    const techAuthUpdateThresholdOneShotUtxo =
      TransactionUnspentOutput.fromCore([
        {
          index: config.main_tech_auth_update_one_shot_index,
          txId: TransactionId(config.main_tech_auth_update_one_shot_hash),
        },
        {
          address: PaymentAddress(deployerAddr),
          value: {
            coins: 100_000_000n,
          },
        },
      ]);

    const techAuthUpdateThresholdAddress = addressFromValidator(
      networkId,
      mainTechAuthUpdateThreshold.Script,
    );

    const thresholdDatum: Contracts.MultisigThreshold = {
      technical_auth_numerator: 2n,
      technical_auth_denominator: 3n,
      council_numerator: 2n,
      council_denominator: 3n,
    };

    const tx = await blaze
      .newTransaction()
      .addInput(techAuthUpdateThresholdOneShotUtxo)
      .addMint(
        PolicyId(mainTechAuthUpdateThreshold.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(mainTechAuthUpdateThreshold.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(techAuthUpdateThresholdAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(mainTechAuthUpdateThreshold.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            thresholdDatum,
          ).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error(
      "Error generating Tech Auth Update Threshold deployment:",
      error,
    );
    throw error;
  }
}

// Transaction 10: Federated Ops Update Threshold Deployment
async function generateFederatedOpsUpdateThresholdDeployment() {
  console.log(
    "Generating Federated Ops Update Threshold deployment transaction...",
  );

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
    const federatedOpsUpdateThresholdOneShotUtxo =
      TransactionUnspentOutput.fromCore([
        {
          index: config.main_federated_ops_update_one_shot_index,
          txId: TransactionId(config.main_federated_ops_update_one_shot_hash),
        },
        {
          address: PaymentAddress(deployerAddr),
          value: {
            coins: 100_000_000n,
          },
        },
      ]);

    const federatedOpsUpdateThresholdAddress = addressFromValidator(
      networkId,
      mainFederatedOpsUpdateThreshold.Script,
    );

    const thresholdDatum: Contracts.MultisigThreshold = {
      technical_auth_numerator: 2n,
      technical_auth_denominator: 3n,
      council_numerator: 2n,
      council_denominator: 3n,
    };

    const tx = await blaze
      .newTransaction()
      .addInput(federatedOpsUpdateThresholdOneShotUtxo)
      .addMint(
        PolicyId(mainFederatedOpsUpdateThreshold.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(mainFederatedOpsUpdateThreshold.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(
            federatedOpsUpdateThresholdAddress.toBech32(),
          ),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(mainFederatedOpsUpdateThreshold.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            thresholdDatum,
          ).toCore(),
        }),
      )
      .complete();

    return tx;
  } catch (error) {
    console.error(
      "Error generating Federated Ops Update Threshold deployment:",
      error,
    );
    throw error;
  }
}

// Main execution
async function main() {
  try {
    console.log(`===========================================`);
    console.log(`Generating deployment transactions for ${network}`);
    console.log(`===========================================`);

    // Generate all deployment transactions
    const transactions = [
      {
        name: "technical-authority-deployment",
        generator: generateTechAuthDeployment,
      },
      { name: "council-deployment", generator: generateCouncilDeployment },
      { name: "reserve-deployment", generator: generateReserveDeployment },
      { name: "ics-deployment", generator: generateIcsDeployment },
      {
        name: "federated-ops-deployment",
        generator: generateFederatedOpsDeployment,
      },
      {
        name: "main-gov-threshold-deployment",
        generator: generateMainGovThresholdDeployment,
      },
      {
        name: "staging-gov-threshold-deployment",
        generator: generateStagingGovThresholdDeployment,
      },
      {
        name: "council-update-threshold-deployment",
        generator: generateCouncilUpdateThresholdDeployment,
      },
      {
        name: "tech-auth-update-threshold-deployment",
        generator: generateTechAuthUpdateThresholdDeployment,
      },
      {
        name: "federated-ops-update-threshold-deployment",
        generator: generateFederatedOpsUpdateThresholdDeployment,
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

// Run the script
main();

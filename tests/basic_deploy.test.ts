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
  PlutusList,
  PolicyId,
  toHex,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../contract_blueprint";
import { beforeEach, describe, test } from "bun:test";

describe("Basic Deploy", () => {
  const amount = 100_000_000n; // 100 ADA
  const scriptAmount = 10_000_000n; // 10 ADA for script outputs

  const emulator = new Emulator([]);

  // Contract instances
  const techAuthTwoStage =
    new Contracts.PermissionedTechAuthTwoStageUpgradeElse();
  const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
  const techAuthLogic = new Contracts.PermissionedTechAuthLogicElse();
  const councilTwoStage =
    new Contracts.PermissionedCouncilTwoStageUpgradeElse();
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
  const federatedOpsForever =
    new Contracts.PermissionedFederatedOpsForeverElse();
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

  // Default network config values from aiken.toml
  const config = {
    technical_authority_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000004",
    technical_authority_one_shot_index: 1,
    council_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000002",
    council_one_shot_index: 1,
    reserve_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000001",
    reserve_one_shot_index: 1,
    ics_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000003",
    ics_one_shot_index: 1,
    federated_operators_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000005",
    federated_operators_one_shot_index: 1,
    main_gov_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000006",
    main_gov_one_shot_index: 1,
    staging_gov_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000007",
    staging_gov_one_shot_index: 1,
    main_council_update_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000008",
    main_council_update_one_shot_index: 1,
    main_tech_auth_update_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000009",
    main_tech_auth_update_one_shot_index: 1,
    main_federated_ops_update_one_shot_hash:
      "000000000000000000000000000000000000000000000000000000000000000a",
    main_federated_ops_update_one_shot_index: 1,
  };

  beforeEach(async () => {
    // Reset emulator state
  });

  describe("Sequential minting of governance tokens", () => {
    test("Can Deploy Reserve contracts", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "1111111111111111111111111111111111111111111111111111111111111111",
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: amount * 10n, // Enough for multiple transactions
              },
            },
          ]),
        );

        // Create one-shot UTxOs that will be consumed for minting
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        const reserveOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.reserve_one_shot_index,
            txId: TransactionId(config.reserve_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        // Transaction 1: Mint Technical Authority tokens (two-stage)
        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        // Create upgrade state datum for technical authority two-stage
        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(), // logic script hash
          "", // mitigation_logic (empty initially)
          govAuth.Script.hash(), // auth script hash
          "", // mitigation_auth (empty initially)
          0n, // round
        ];

        // Create upgrade state datum for technical authority two-stage
        const techAuthForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const redeemerForever: Contracts.PermissionedRedeemer = {
          [addr.asBase()?.getPaymentCredential().hash!]:
            "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          [addr.asBase()?.getStakeCredential().hash!]:
            "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
        };

        const foreverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo) // No redeemer for regular UTxO
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, redeemerForever),
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
                address: PaymentAddress(foreverAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        emulator.addUtxo(councilOneShotUtxo);

        // Transaction 2: Mint Council tokens (two-stage)
        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(), // logic script hash
          "", // mitigation_logic (empty initially)
          govAuth.Script.hash(), // auth script hash
          "", // mitigation_auth (empty initially)
          0n, // round
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo) // No redeemer for regular UTxO
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  councilForeverState,
                ).toCore(),
              }),
            ),
        );

        // Transaction 3: Mint Reserve tokens (forever)

        emulator.addUtxo(reserveOneShotUtxo);
        const reserveForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          reserveForever.Script,
        );

        const reserveTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          reserveTwoStage.Script,
        );

        const reserveUpgradeState: Contracts.UpgradeState = [
          reserveLogic.Script.hash(), // logic script hash
          "", // mitigation_logic (empty initially)
          govAuth.Script.hash(), // auth script hash
          "", // mitigation_auth (empty initially)
          0n, // round
        ];

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(reserveOneShotUtxo) // No redeemer for regular UTxO
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
                  assets: new Map([
                    [AssetId(reserveForever.Script.hash()), 1n],
                  ]),
                },
                datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
              }),
            ),
        );
      });
    });

    test("can deploy ICS (Iliquid Circulation Supply) contracts", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "2222222222222222222222222222222222222222222222222222222222222222",
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: amount * 10n,
              },
            },
          ]),
        );

        // Step 1: Pre-deploy Technical Authority
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 2: Pre-deploy Council
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  councilForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 3: Deploy ICS
        // Create ICS one-shot UTxO
        const icsOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.ics_one_shot_index,
            txId: TransactionId(config.ics_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(icsOneShotUtxo);

        const icsForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          icsForever.Script,
        );

        const icsTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          icsTwoStage.Script,
        );

        const icsUpgradeState: Contracts.UpgradeState = [
          icsLogic.Script.hash(), // logic script hash
          "", // mitigation_logic (empty initially)
          govAuth.Script.hash(), // auth script hash
          "", // mitigation_auth (empty initially)
          0n, // round
        ];

        await emulator.expectValidTransaction(
          blaze,
          blaze
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
                datum: serialize(
                  Contracts.UpgradeState,
                  icsUpgradeState,
                ).toCore(),
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
                datum: serialize(
                  Contracts.UpgradeState,
                  icsUpgradeState,
                ).toCore(),
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
            ),
        );
      });
    });

    test("can deploy Federated Operators contracts", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "3333333333333333333333333333333333333333333333333333333333333333",
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: amount * 10n,
              },
            },
          ]),
        );

        // Step 1: Pre-deploy Technical Authority
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 2: Pre-deploy Council
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  councilForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 3: Deploy Federated Operators
        // Create Federated Operators one-shot UTxO
        const federatedOpsOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.federated_operators_one_shot_index,
            txId: TransactionId(config.federated_operators_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(federatedOpsOneShotUtxo);

        const federatedOpsForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          federatedOpsForever.Script,
        );

        const federatedOpsTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          federatedOpsTwoStage.Script,
        );

        const federatedOpsUpgradeState: Contracts.UpgradeState = [
          federatedOpsLogic.Script.hash(), // logic script hash
          "", // mitigation_logic (empty initially)
          govAuth.Script.hash(), // auth script hash
          "", // mitigation_auth (empty initially)
          0n, // round
        ];

        const federatedOpsForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(federatedOpsOneShotUtxo)
            .addMint(
              PolicyId(federatedOpsForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(federatedOpsForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  federatedOpsForeverState,
                ).toCore(),
              }),
            ),
        );
      });
    });

    test("can deploy Main Government Threshold validator", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "4444444444444444444444444444444444444444444444444444444444444444",
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: amount * 10n,
              },
            },
          ]),
        );

        // Step 1: Pre-deploy Technical Authority
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 2: Pre-deploy Council
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  councilForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 3: Deploy Main Government Threshold validator
        // Create Main Gov Threshold one-shot UTxO
        const mainGovThresholdOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.main_gov_one_shot_index,
            txId: TransactionId(config.main_gov_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(mainGovThresholdOneShotUtxo);

        const mainGovThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          mainGovThreshold.Script,
        );

        const thresholdDatum: Contracts.MultisigThreshold = {
          technical_auth_numerator: 2n,
          technical_auth_denominator: 3n,
          council_numerator: 2n,
          council_denominator: 3n,
        };

        await emulator.expectValidTransaction(
          blaze,
          blaze
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
                  assets: new Map([
                    [AssetId(mainGovThreshold.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.MultisigThreshold,
                  thresholdDatum,
                ).toCore(),
              }),
            ),
        );
      });
    });

    test("can deploy Staging Government Threshold validator", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "5555555555555555555555555555555555555555555555555555555555555555",
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: amount * 10n,
              },
            },
          ]),
        );

        // Step 1: Pre-deploy Technical Authority
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 2: Pre-deploy Council
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  councilForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 3: Deploy Staging Government Threshold validator
        // Create Staging Gov Threshold one-shot UTxO
        const stagingGovThresholdOneShotUtxo =
          TransactionUnspentOutput.fromCore([
            {
              index: config.staging_gov_one_shot_index,
              txId: TransactionId(config.staging_gov_one_shot_hash),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: 10_000_000n,
              },
            },
          ]);

        emulator.addUtxo(stagingGovThresholdOneShotUtxo);

        const stagingGovThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          stagingGovThreshold.Script,
        );

        const thresholdDatum: Contracts.MultisigThreshold = {
          technical_auth_numerator: 1n,
          technical_auth_denominator: 2n,
          council_numerator: 1n,
          council_denominator: 2n,
        };

        await emulator.expectValidTransaction(
          blaze,
          blaze
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
                  assets: new Map([
                    [AssetId(stagingGovThreshold.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.MultisigThreshold,
                  thresholdDatum,
                ).toCore(),
              }),
            ),
        );
      });
    });

    test("can deploy Council Update Threshold validator", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "6666666666666666666666666666666666666666666666666666666666666666",
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: amount * 10n,
              },
            },
          ]),
        );

        // Step 1: Pre-deploy Technical Authority
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 2: Pre-deploy Council
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  councilForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 3: Deploy Council Update Threshold validator
        // Create Council Update Threshold one-shot UTxO
        const councilUpdateThresholdOneShotUtxo =
          TransactionUnspentOutput.fromCore([
            {
              index: config.main_council_update_one_shot_index,
              txId: TransactionId(config.main_council_update_one_shot_hash),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: 10_000_000n,
              },
            },
          ]);

        emulator.addUtxo(councilUpdateThresholdOneShotUtxo);

        const councilUpdateThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          mainCouncilUpdateThreshold.Script,
        );

        const thresholdDatum: Contracts.MultisigThreshold = {
          technical_auth_numerator: 2n,
          technical_auth_denominator: 3n,
          council_numerator: 2n,
          council_denominator: 3n,
        };

        await emulator.expectValidTransaction(
          blaze,
          blaze
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
                address: PaymentAddress(
                  councilUpdateThresholdAddress.toBech32(),
                ),
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
            ),
        );
      });
    });

    test("can deploy Tech Auth Update Threshold validator", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "7777777777777777777777777777777777777777777777777777777777777777",
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: amount * 10n,
              },
            },
          ]),
        );

        // Step 1: Pre-deploy Technical Authority
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 2: Pre-deploy Council
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  councilForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 3: Deploy Tech Auth Update Threshold validator
        const techAuthUpdateThresholdOneShotUtxo =
          TransactionUnspentOutput.fromCore([
            {
              index: config.main_tech_auth_update_one_shot_index,
              txId: TransactionId(config.main_tech_auth_update_one_shot_hash),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: 10_000_000n,
              },
            },
          ]);

        emulator.addUtxo(techAuthUpdateThresholdOneShotUtxo);

        const techAuthUpdateThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          mainTechAuthUpdateThreshold.Script,
        );

        const thresholdDatum: Contracts.MultisigThreshold = {
          technical_auth_numerator: 2n,
          technical_auth_denominator: 3n,
          council_numerator: 2n,
          council_denominator: 3n,
        };

        await emulator.expectValidTransaction(
          blaze,
          blaze
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
                address: PaymentAddress(
                  techAuthUpdateThresholdAddress.toBech32(),
                ),
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
            ),
        );
      });
    });

    test("can deploy Federated Ops Update Threshold validator", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "8888888888888888888888888888888888888888888888888888888888888888",
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: amount * 10n,
              },
            },
          ]),
        );

        // Step 1: Pre-deploy Technical Authority
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 2: Pre-deploy Council
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          govAuth.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          {
            ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
              // 32 byte Sr25519 PubKey
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ];

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  councilForeverState,
                ).toCore(),
              }),
            ),
        );

        // Step 3: Deploy Federated Ops Update Threshold validator
        // Create Federated Ops Update Threshold one-shot UTxO
        const federatedOpsUpdateThresholdOneShotUtxo =
          TransactionUnspentOutput.fromCore([
            {
              index: config.main_federated_ops_update_one_shot_index,
              txId: TransactionId(
                config.main_federated_ops_update_one_shot_hash,
              ),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: 10_000_000n,
              },
            },
          ]);

        emulator.addUtxo(federatedOpsUpdateThresholdOneShotUtxo);

        const federatedOpsUpdateThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          mainFederatedOpsUpdateThreshold.Script,
        );

        const thresholdDatum: Contracts.MultisigThreshold = {
          technical_auth_numerator: 2n,
          technical_auth_denominator: 3n,
          council_numerator: 2n,
          council_denominator: 3n,
        };

        await emulator.expectValidTransaction(
          blaze,
          blaze
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
                    [
                      AssetId(mainFederatedOpsUpdateThreshold.Script.hash()),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.MultisigThreshold,
                  thresholdDatum,
                ).toCore(),
              }),
            ),
        );
      });
    });
  });
});

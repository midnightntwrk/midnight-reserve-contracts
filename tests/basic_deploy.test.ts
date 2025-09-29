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
  };

  beforeEach(async () => {
    // Reset emulator state
  });

  describe("Sequential minting of governance tokens", () => {
    test("can mint tech_auth, council, and reserve tokens in separate transactions", async () => {
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
          PlutusData.fromCore({
            items: [
              fromHex("8200581c" + addr.asBase()?.getPaymentCredential().hash),
              fromHex("8200581c" + addr.asBase()?.getStakeCredential().hash),
            ],
          }),
        ];

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
              PlutusData.fromCore({
                items: [
                  fromHex(addr.asBase()?.getPaymentCredential().hash!),
                  fromHex(addr.asBase()?.getStakeCredential().hash!),
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
          PlutusData.fromCore({
            items: [
              fromHex("8200581c" + addr.asBase()?.getPaymentCredential().hash),
              fromHex("8200581c" + addr.asBase()?.getStakeCredential().hash),
            ],
          }),
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
              PlutusData.fromCore({
                items: [
                  fromHex(addr.asBase()?.getPaymentCredential().hash!),
                  fromHex(addr.asBase()?.getStakeCredential().hash!),
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
  });
});

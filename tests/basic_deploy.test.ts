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
  const councilTwoStage =
    new Contracts.PermissionedCouncilTwoStageUpgradeElse();
  const reserveForever = new Contracts.ReserveReserveForeverElse();

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
          new Contracts.PermissionedTechAuthLogicElse().Script.hash(), // logic script hash
          "", // mitigation_logic (empty initially)
          new Contracts.GovAuthMainGovAuthElse().Script.hash(), // auth script hash
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

        console.log("HERE");

        const foreverAddress = addressFromValidator(
          NetworkId.Testnet,
          new Contracts.PermissionedTechAuthForeverElse().Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo) // No redeemer for regular UTxO
            .addMint(
              PolicyId(
                new Contracts.PermissionedTechAuthForeverElse().Script.hash(),
              ),
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
            .provideScript(
              new Contracts.PermissionedTechAuthForeverElse().Script,
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
                    [
                      AssetId(
                        new Contracts.PermissionedTechAuthForeverElse().Script.hash(),
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.Multisig,
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        console.log("THERE");

        emulator.addUtxo(councilOneShotUtxo);

        // Transaction 2: Mint Council tokens (two-stage)
        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          "5555555555555555555555555555555555555555555555555555555555", // logic script hash
          "", // mitigation_logic (empty initially)
          "6666666666666666666666666666666666666666666666666666666666", // auth script hash
          "", // mitigation_auth (empty initially)
          0n, // round
        ];

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo) // No redeemer for regular UTxO
            .provideScript(councilTwoStage.Script),
        );

        // Transaction 3: Mint Reserve tokens (forever)

        emulator.addUtxo(reserveOneShotUtxo);
        const reserveForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          reserveForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(reserveOneShotUtxo) // No redeemer for regular UTxO
            .provideScript(reserveForever.Script),
        );
      });
    });
  });
});

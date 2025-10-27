import {
  Address,
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  HexBlob,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  RewardAccount,
  toHex,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../contract_blueprint";
import { describe, test } from "bun:test";

describe("Reserve Deploy and Merge", () => {
  const amount = 100_000_000n;

  const emulator = new Emulator([]);

  const reserveForever = new Contracts.ReserveReserveForeverElse();
  const reserveTwoStage = new Contracts.ReserveReserveTwoStageUpgradeElse();
  const reserveLogic = new Contracts.ReserveReserveLogicElse();
  const govAuth = new Contracts.GovAuthMainGovAuthElse();

  const config = {
    reserve_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000001",
    reserve_one_shot_index: 1,
  };

  test("Deploy Reserve and merge UTxOs", async () => {
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
              coins: amount * 10n,
            },
          },
        ]),
      );

      // Create one-shot UTxO for minting
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
        reserveLogic.Script.hash(),
        "",
        govAuth.Script.hash(),
        "",
        0n,
      ];

      // Step 1: Deploy Reserve contracts
      await emulator.expectValidTransaction(
        blaze,
        blaze
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
          ),
      );

      // Add the two-stage main state as a reference input for future transactions
      const twoStageMainUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId(
            "4444444444444444444444444444444444444444444444444444444444444444",
          ),
        },
        {
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
        },
      ]);

      emulator.addUtxo(twoStageMainUtxo);

      // Step 2: Create two UTxOs at the reserve address with different token amounts
      const utxo1 = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId(
            "2222222222222222222222222222222222222222222222222222222222222222",
          ),
        },
        {
          address: PaymentAddress(reserveForeverAddress.toBech32()),
          value: {
            coins: 5_000_000n,
            assets: new Map([[AssetId(reserveForever.Script.hash()), 3n]]),
          },
          datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
        },
      ]);

      const utxo2 = TransactionUnspentOutput.fromCore([
        {
          index: 1,
          txId: TransactionId(
            "3333333333333333333333333333333333333333333333333333333333333333",
          ),
        },
        {
          address: PaymentAddress(reserveForeverAddress.toBech32()),
          value: {
            coins: 3_000_000n,
            assets: new Map([
              [AssetId(reserveForever.Script.hash()), 2n],
              [AssetId(reserveTwoStage.Script.hash() + "abababab"), 2n],
            ]),
          },
          datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
        },
      ]);

      // Add the two UTxOs to the emulator
      emulator.addUtxo(utxo1);
      emulator.addUtxo(utxo2);

      // Step 3: Merge the two UTxOs using logic_merge
      const reserveLogicCredential = RewardAccount.fromCredential(
        Credential.fromCore({
          hash: reserveLogic.Script.hash(),
          type: CredentialType.ScriptHash,
        }).toCore(),
        NetworkId.Testnet,
      );

      // Register the reward account with zero balance for withdrawal
      emulator.accounts.set(reserveLogicCredential, 0n);

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(utxo1, PlutusData.fromCbor(HexBlob("01")))
          .addInput(utxo2, PlutusData.fromCbor(HexBlob("01")))
          .addReferenceInput(twoStageMainUtxo)
          .provideScript(reserveForever.Script)
          .addWithdrawal(
            reserveLogicCredential,
            0n,
            PlutusData.fromCbor(HexBlob("01")),
          )
          .provideScript(reserveLogic.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(reserveForeverAddress.toBech32()),
              value: {
                coins: 8_000_000n,
                assets: new Map([
                  [AssetId(reserveForever.Script.hash()), 5n],
                  [AssetId(reserveTwoStage.Script.hash() + "abababab"), 2n],
                ]),
              },
              datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
            }),
          ),
      );
    });
  });
});

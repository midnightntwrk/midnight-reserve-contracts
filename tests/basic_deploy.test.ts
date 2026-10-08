import {
  addressFromValidator,
  AssetId,
  AssetName,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  toHex,
  TransactionOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import { beforeEach, describe, test } from "bun:test";
import {
  addFundingUtxo,
  createContracts,
  createOneShotUtxo,
  DEFAULT_CONFIG,
  deployTechAuthAndCouncil,
} from "./helpers/deploy";

describe("Basic Deploy", () => {
  const amount = 100_000_000n;
  let emulator: Emulator;
  const contracts = createContracts();
  const config = DEFAULT_CONFIG;

  beforeEach(() => {
    emulator = new Emulator([]);
  });

  describe("Sequential minting of governance tokens", () => {
    test("Can Deploy Reserve contracts", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        addFundingUtxo(
          emulator,
          addr,
          "1111111111111111111111111111111111111111111111111111111111111111",
          amount * 10n,
        );

        await deployTechAuthAndCouncil(
          emulator,
          blaze,
          addr,
          contracts,
          config,
        );

        const reserveOneShotUtxo = createOneShotUtxo(
          addr,
          config.reserve_one_shot_hash,
          config.reserve_one_shot_index,
        );
        emulator.addUtxo(reserveOneShotUtxo);

        const reserveForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          contracts.reserveForever.Script,
        );

        const reserveTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          contracts.reserveTwoStage.Script,
        );

        const reserveUpgradeState: Contracts.UpgradeState = [
          contracts.reserveLogic.Script.hash(),
          "",
          contracts.govAuth.Script.hash(),
          "",
          0n,
          0n,
        ];

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(reserveOneShotUtxo)
            .addMint(
              PolicyId(contracts.reserveForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              PlutusData.newInteger(0n),
            )
            .addMint(
              PolicyId(contracts.reserveTwoStage.Script.hash()),
              new Map([
                [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
                [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
              ]),
              PlutusData.newInteger(0n),
            )
            .provideScript(contracts.reserveForever.Script)
            .provideScript(contracts.reserveTwoStage.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        contracts.reserveTwoStage.Script.hash() +
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
                        contracts.reserveTwoStage.Script.hash() +
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
                    [AssetId(contracts.reserveForever.Script.hash()), 1n],
                  ]),
                },
                datum: PlutusData.fromCore({
                  constructor: 0n,
                  fields: {
                    items: [
                      PlutusData.newInteger(0n).toCore(),
                      PlutusData.newInteger(0n).toCore(),
                    ],
                  },
                }).toCore(),
              }),
            ),
        );
      });
    });

    test("can deploy ICS (illiquid Circulation Supply) contracts", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        addFundingUtxo(
          emulator,
          addr,
          "2222222222222222222222222222222222222222222222222222222222222222",
          amount * 10n,
        );

        await deployTechAuthAndCouncil(
          emulator,
          blaze,
          addr,
          contracts,
          config,
        );

        const icsOneShotUtxo = createOneShotUtxo(
          addr,
          config.ics_one_shot_hash,
          config.ics_one_shot_index,
        );
        emulator.addUtxo(icsOneShotUtxo);

        const icsForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          contracts.icsForever.Script,
        );

        const icsTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          contracts.icsTwoStage.Script,
        );

        const icsUpgradeState: Contracts.UpgradeState = [
          contracts.icsLogic.Script.hash(),
          "",
          contracts.govAuth.Script.hash(),
          "",
          0n,
          0n,
        ];

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(icsOneShotUtxo)
            .addMint(
              PolicyId(contracts.icsForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              PlutusData.newInteger(0n),
            )
            .addMint(
              PolicyId(contracts.icsTwoStage.Script.hash()),
              new Map([
                [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
                [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
              ]),
              PlutusData.newInteger(0n),
            )
            .provideScript(contracts.icsForever.Script)
            .provideScript(contracts.icsTwoStage.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(icsTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        contracts.icsTwoStage.Script.hash() +
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
                        contracts.icsTwoStage.Script.hash() +
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
                  assets: new Map([
                    [AssetId(contracts.icsForever.Script.hash()), 1n],
                  ]),
                },
                datum: PlutusData.fromCore({
                  constructor: 0n,
                  fields: {
                    items: [
                      PlutusData.newInteger(0n).toCore(),
                      PlutusData.newInteger(0n).toCore(),
                    ],
                  },
                }).toCore(),
              }),
            ),
        );
      });
    });
  });
});

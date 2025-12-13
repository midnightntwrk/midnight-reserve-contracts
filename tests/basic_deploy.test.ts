import {
  addressFromValidator,
  AssetId,
  AssetName,
  HexBlob,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  toHex,
  TransactionOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../contract_blueprint";
import { describe, test } from "bun:test";
import {
  addFundingUtxo,
  createContracts,
  createOneShotUtxo,
  DEFAULT_CONFIG,
  deployTechAuthAndCouncil,
} from "./helpers/deploy";

describe("Basic Deploy", () => {
  const amount = 100_000_000n;
  const emulator = new Emulator([]);
  const contracts = createContracts();
  const config = DEFAULT_CONFIG;

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
                datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
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
                datum: PlutusData.fromCbor(HexBlob("01")).toCore(),
              }),
            ),
        );
      });
    });

    test("can deploy Federated Operators contracts", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        addFundingUtxo(
          emulator,
          addr,
          "3333333333333333333333333333333333333333333333333333333333333333",
          amount * 10n,
        );

        await deployTechAuthAndCouncil(
          emulator,
          blaze,
          addr,
          contracts,
          config,
        );

        const federatedOpsOneShotUtxo = createOneShotUtxo(
          addr,
          config.federated_operators_one_shot_hash,
          config.federated_operators_one_shot_index,
        );
        emulator.addUtxo(federatedOpsOneShotUtxo);

        const federatedOpsForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          contracts.federatedOpsForever.Script,
        );

        const federatedOpsTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          contracts.federatedOpsTwoStage.Script,
        );

        const federatedOpsUpgradeState: Contracts.UpgradeState = [
          contracts.federatedOpsLogic.Script.hash(),
          "",
          contracts.govAuth.Script.hash(),
          "",
          0n,
          0n,
        ];

        const federatedOpsForeverState: Contracts.VersionedMultisig = [
          [
            2n,
            {
              ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
                "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
              ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
                "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            },
          ],
          0n,
        ];

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(federatedOpsOneShotUtxo)
            .addMint(
              PolicyId(contracts.federatedOpsForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
              }),
            )
            .addMint(
              PolicyId(contracts.federatedOpsTwoStage.Script.hash()),
              new Map([
                [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
                [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
              ]),
              PlutusData.newInteger(0n),
            )
            .provideScript(contracts.federatedOpsForever.Script)
            .provideScript(contracts.federatedOpsTwoStage.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        contracts.federatedOpsTwoStage.Script.hash() +
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
                        contracts.federatedOpsTwoStage.Script.hash() +
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
                    [AssetId(contracts.federatedOpsForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.VersionedMultisig,
                  federatedOpsForeverState,
                ).toCore(),
              }),
            ),
        );
      });
    });
  });
});

import {
  addressFromValidator,
  AssetId,
  AssetName,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
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

describe("Deploy Thresholds", () => {
  const amount = 100_000_000n;
  const emulator = new Emulator([]);
  const contracts = createContracts();
  const config = DEFAULT_CONFIG;

  test("can deploy Main Government Threshold validator", async () => {
    await emulator.as("deployer", async (blaze, addr) => {
      addFundingUtxo(
        emulator,
        addr,
        "4444444444444444444444444444444444444444444444444444444444444444",
        amount * 10n,
      );

      await deployTechAuthAndCouncil(emulator, blaze, addr, contracts, config);

      const mainGovThresholdOneShotUtxo = createOneShotUtxo(
        addr,
        config.main_gov_one_shot_hash,
        config.main_gov_one_shot_index,
      );
      emulator.addUtxo(mainGovThresholdOneShotUtxo);

      const mainGovThresholdAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.mainGovThreshold.Script,
      );

      const thresholdDatum: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(mainGovThresholdOneShotUtxo)
          .addMint(
            PolicyId(contracts.mainGovThreshold.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            PlutusData.newInteger(0n),
          )
          .provideScript(contracts.mainGovThreshold.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(mainGovThresholdAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(contracts.mainGovThreshold.Script.hash()), 1n],
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
      addFundingUtxo(
        emulator,
        addr,
        "5555555555555555555555555555555555555555555555555555555555555555",
        amount * 10n,
      );

      await deployTechAuthAndCouncil(emulator, blaze, addr, contracts, config);

      const stagingGovThresholdOneShotUtxo = createOneShotUtxo(
        addr,
        config.staging_gov_one_shot_hash,
        config.staging_gov_one_shot_index,
      );
      emulator.addUtxo(stagingGovThresholdOneShotUtxo);

      const stagingGovThresholdAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.stagingGovThreshold.Script,
      );

      const thresholdDatum: Contracts.MultisigThreshold = [1n, 2n, 1n, 2n];

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(stagingGovThresholdOneShotUtxo)
          .addMint(
            PolicyId(contracts.stagingGovThreshold.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            PlutusData.newInteger(0n),
          )
          .provideScript(contracts.stagingGovThreshold.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(stagingGovThresholdAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(contracts.stagingGovThreshold.Script.hash()), 1n],
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
      addFundingUtxo(
        emulator,
        addr,
        "6666666666666666666666666666666666666666666666666666666666666666",
        amount * 10n,
      );

      await deployTechAuthAndCouncil(emulator, blaze, addr, contracts, config);

      const councilUpdateThresholdOneShotUtxo = createOneShotUtxo(
        addr,
        config.main_council_update_one_shot_hash,
        config.main_council_update_one_shot_index,
      );
      emulator.addUtxo(councilUpdateThresholdOneShotUtxo);

      const councilUpdateThresholdAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.mainCouncilUpdateThreshold.Script,
      );

      const thresholdDatum: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(councilUpdateThresholdOneShotUtxo)
          .addMint(
            PolicyId(contracts.mainCouncilUpdateThreshold.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            PlutusData.newInteger(0n),
          )
          .provideScript(contracts.mainCouncilUpdateThreshold.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(councilUpdateThresholdAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(contracts.mainCouncilUpdateThreshold.Script.hash()),
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

  test("can deploy Tech Auth Update Threshold validator", async () => {
    await emulator.as("deployer", async (blaze, addr) => {
      addFundingUtxo(
        emulator,
        addr,
        "7777777777777777777777777777777777777777777777777777777777777777",
        amount * 10n,
      );

      await deployTechAuthAndCouncil(emulator, blaze, addr, contracts, config);

      const techAuthUpdateThresholdOneShotUtxo = createOneShotUtxo(
        addr,
        config.main_tech_auth_update_one_shot_hash,
        config.main_tech_auth_update_one_shot_index,
      );
      emulator.addUtxo(techAuthUpdateThresholdOneShotUtxo);

      const techAuthUpdateThresholdAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.mainTechAuthUpdateThreshold.Script,
      );

      const thresholdDatum: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(techAuthUpdateThresholdOneShotUtxo)
          .addMint(
            PolicyId(contracts.mainTechAuthUpdateThreshold.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            PlutusData.newInteger(0n),
          )
          .provideScript(contracts.mainTechAuthUpdateThreshold.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                techAuthUpdateThresholdAddress.toBech32(),
              ),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(
                      contracts.mainTechAuthUpdateThreshold.Script.hash(),
                    ),
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

  test("can deploy Federated Ops Update Threshold validator", async () => {
    await emulator.as("deployer", async (blaze, addr) => {
      addFundingUtxo(
        emulator,
        addr,
        "8888888888888888888888888888888888888888888888888888888888888888",
        amount * 10n,
      );

      await deployTechAuthAndCouncil(emulator, blaze, addr, contracts, config);

      const federatedOpsUpdateThresholdOneShotUtxo = createOneShotUtxo(
        addr,
        config.main_federated_ops_update_one_shot_hash,
        config.main_federated_ops_update_one_shot_index,
      );
      emulator.addUtxo(federatedOpsUpdateThresholdOneShotUtxo);

      const federatedOpsUpdateThresholdAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.mainFederatedOpsUpdateThreshold.Script,
      );

      const thresholdDatum: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(federatedOpsUpdateThresholdOneShotUtxo)
          .addMint(
            PolicyId(contracts.mainFederatedOpsUpdateThreshold.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            PlutusData.newInteger(0n),
          )
          .provideScript(contracts.mainFederatedOpsUpdateThreshold.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                federatedOpsUpdateThresholdAddress.toBech32(),
              ),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(
                      contracts.mainFederatedOpsUpdateThreshold.Script.hash(),
                    ),
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

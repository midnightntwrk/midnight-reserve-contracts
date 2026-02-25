import {
  addressFromValidator,
  AssetId,
  AssetName,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  toHex,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
  type Address,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type { Emulator } from "@blaze-cardano/emulator";
import type { Blaze, Provider, Wallet } from "@blaze-cardano/sdk";
import * as Contracts from "../../deployed-scripts/mainnet/contract_blueprint";

// Mainnet one-shot UTxO: all contracts share the same deployment tx hash
const MAINNET_ONE_SHOT_HASH =
  "d514e2ca336b1b6bb962433c4730fe7cab593b7ca230208a73896cf2145cb717";

export const DEFAULT_CONFIG = {
  technical_authority_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  technical_authority_one_shot_index: 3,
  council_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  council_one_shot_index: 1,
  reserve_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  reserve_one_shot_index: 0,
  ics_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  ics_one_shot_index: 2,
  federated_operators_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  federated_operators_one_shot_index: 4,
  main_gov_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  main_gov_one_shot_index: 5,
  staging_gov_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  staging_gov_one_shot_index: 6,
  main_council_update_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  main_council_update_one_shot_index: 7,
  main_tech_auth_update_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  main_tech_auth_update_one_shot_index: 8,
  main_federated_ops_update_one_shot_hash: MAINNET_ONE_SHOT_HASH,
  main_federated_ops_update_one_shot_index: 9,
};

export const createContracts = () => ({
  techAuthTwoStage: new Contracts.PermissionedTechAuthTwoStageUpgradeElse(),
  techAuthForever: new Contracts.PermissionedTechAuthForeverElse(),
  techAuthLogic: new Contracts.PermissionedTechAuthLogicElse(),
  councilTwoStage: new Contracts.PermissionedCouncilTwoStageUpgradeElse(),
  councilForever: new Contracts.PermissionedCouncilForeverElse(),
  councilLogic: new Contracts.PermissionedCouncilLogicElse(),
  reserveForever: new Contracts.ReserveReserveForeverElse(),
  reserveTwoStage: new Contracts.ReserveReserveTwoStageUpgradeElse(),
  reserveLogic: new Contracts.ReserveReserveLogicElse(),
  govAuth: new Contracts.GovAuthMainGovAuthElse(),
  icsForever: new Contracts.IlliquidCirculationSupplyIcsForeverElse(),
  icsTwoStage: new Contracts.IlliquidCirculationSupplyIcsTwoStageUpgradeElse(),
  icsLogic: new Contracts.IlliquidCirculationSupplyIcsLogicElse(),
  federatedOpsForever: new Contracts.PermissionedFederatedOpsForeverElse(),
  federatedOpsTwoStage:
    new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse(),
  federatedOpsLogic: new Contracts.PermissionedFederatedOpsLogicElse(),
  mainGovThreshold: new Contracts.ThresholdsMainGovThresholdElse(),
  stagingGovThreshold: new Contracts.ThresholdsStagingGovThresholdElse(),
  mainCouncilUpdateThreshold:
    new Contracts.ThresholdsMainCouncilUpdateThresholdElse(),
  mainTechAuthUpdateThreshold:
    new Contracts.ThresholdsMainTechAuthUpdateThresholdElse(),
  mainFederatedOpsUpdateThreshold:
    new Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse(),
});

export type DeployContracts = ReturnType<typeof createContracts>;

export const addFundingUtxo = (
  emulator: Emulator,
  addr: Address,
  txIdHex: string,
  amount: bigint,
) => {
  emulator.addUtxo(
    TransactionUnspentOutput.fromCore([
      {
        index: 0,
        txId: TransactionId(txIdHex),
      },
      {
        address: PaymentAddress(addr.toBech32()),
        value: { coins: amount },
      },
    ]),
  );
};

export const createOneShotUtxo = (
  addr: Address,
  txIdHash: string,
  index: number,
) =>
  TransactionUnspentOutput.fromCore([
    {
      index,
      txId: TransactionId(txIdHash),
    },
    {
      address: PaymentAddress(addr.toBech32()),
      value: { coins: 10_000_000n },
    },
  ]);

export const deployTechAuth = async (
  emulator: Emulator,
  blaze: Blaze<Provider, Wallet>,
  addr: Address,
  contracts: DeployContracts,
  config = DEFAULT_CONFIG,
) => {
  const techAuthOneShotUtxo = createOneShotUtxo(
    addr,
    config.technical_authority_one_shot_hash,
    config.technical_authority_one_shot_index,
  );
  emulator.addUtxo(techAuthOneShotUtxo);

  const techAuthTwoStageAddress = addressFromValidator(
    NetworkId.Testnet,
    contracts.techAuthTwoStage.Script,
  );

  const techAuthUpgradeState: Contracts.UpgradeState = [
    contracts.techAuthLogic.Script.hash(),
    "",
    contracts.govAuth.Script.hash(),
    "",
    0n,
    0n,
  ];

  const techAuthForeverState: Contracts.VersionedMultisig = [
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

  const techAuthForeverAddress = addressFromValidator(
    NetworkId.Testnet,
    contracts.techAuthForever.Script,
  );

  await emulator.expectValidTransaction(
    blaze,
    blaze
      .newTransaction()
      .addInput(techAuthOneShotUtxo)
      .addMint(
        PolicyId(contracts.techAuthForever.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        serialize(Contracts.PermissionedRedeemer, {
          [addr.asBase()?.getPaymentCredential().hash!]:
            "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          [addr.asBase()?.getStakeCredential().hash!]:
            "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
        }),
      )
      .addMint(
        PolicyId(contracts.techAuthTwoStage.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(contracts.techAuthTwoStage.Script)
      .provideScript(contracts.techAuthForever.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  contracts.techAuthTwoStage.Script.hash() +
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
                  contracts.techAuthTwoStage.Script.hash() +
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
              [AssetId(contracts.techAuthForever.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.VersionedMultisig,
            techAuthForeverState,
          ).toCore(),
        }),
      ),
  );
};

export const deployCouncil = async (
  emulator: Emulator,
  blaze: Blaze<Provider, Wallet>,
  addr: Address,
  contracts: DeployContracts,
  config = DEFAULT_CONFIG,
) => {
  const councilOneShotUtxo = createOneShotUtxo(
    addr,
    config.council_one_shot_hash,
    config.council_one_shot_index,
  );
  emulator.addUtxo(councilOneShotUtxo);

  const councilTwoStageAddress = addressFromValidator(
    NetworkId.Testnet,
    contracts.councilTwoStage.Script,
  );

  const councilUpgradeState: Contracts.UpgradeState = [
    contracts.councilLogic.Script.hash(),
    "",
    contracts.govAuth.Script.hash(),
    "",
    0n,
    0n,
  ];

  const councilForeverState: Contracts.VersionedMultisig = [
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

  const councilForeverAddress = addressFromValidator(
    NetworkId.Testnet,
    contracts.councilForever.Script,
  );

  await emulator.expectValidTransaction(
    blaze,
    blaze
      .newTransaction()
      .addInput(councilOneShotUtxo)
      .addMint(
        PolicyId(contracts.councilForever.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        serialize(Contracts.PermissionedRedeemer, {
          [addr.asBase()?.getPaymentCredential().hash!]:
            "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          [addr.asBase()?.getStakeCredential().hash!]:
            "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
        }),
      )
      .addMint(
        PolicyId(contracts.councilTwoStage.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(contracts.councilTwoStage.Script)
      .provideScript(contracts.councilForever.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(councilTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  contracts.councilTwoStage.Script.hash() +
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
                  contracts.councilTwoStage.Script.hash() +
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
              [AssetId(contracts.councilForever.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.VersionedMultisig,
            councilForeverState,
          ).toCore(),
        }),
      ),
  );
};

export const deployTechAuthAndCouncil = async (
  emulator: Emulator,
  blaze: Blaze<Provider, Wallet>,
  addr: Address,
  contracts: DeployContracts,
  config = DEFAULT_CONFIG,
) => {
  await deployTechAuth(emulator, blaze, addr, contracts, config);
  await deployCouncil(emulator, blaze, addr, contracts, config);
};

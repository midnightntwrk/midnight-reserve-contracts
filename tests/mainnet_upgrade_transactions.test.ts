import {
  AssetId,
  AssetName,
  NetworkId,
  PaymentAddress,
  PolicyId,
  Script,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import { describe, expect, test } from "bun:test";
import { extractSignersFromCbor } from "../cli-yargs/lib/signers";
import {
  createNativeMultisigScript,
  createRewardAccount,
} from "../cli-yargs/lib/transaction";
import { thresholdToRequiredSigners } from "../cli-yargs/lib/validation";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import {
  liveThresholds,
  liveUpgradeStates,
  mainnetSnapshotUtxos,
  makeFundingUtxo,
} from "./helpers/mainnet-snapshot";
import {
  COUNCIL_WITNESS_ASSET,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
  TECH_WITNESS_ASSET,
} from "./helpers/upgrade";

const mainGovAuth = new Contracts.GovAuthMainGovAuthElse();
const stagingGovAuth = new Contracts.GovAuthStagingGovAuthElse();
const reserveTwoStage = new Contracts.ReserveReserveTwoStageUpgradeElse();
const councilTwoStage = new Contracts.PermissionedCouncilTwoStageUpgradeElse();
const techAuthTwoStage =
  new Contracts.PermissionedTechAuthTwoStageUpgradeElse();

const techAuthDatum = mainnetSnapshotUtxos.techAuthForever
  .output()
  .datum()
  ?.asInlineData();
const councilDatum = mainnetSnapshotUtxos.councilForever
  .output()
  .datum()
  ?.asInlineData();
if (!techAuthDatum || !councilDatum) {
  throw new Error("Mainnet multisig snapshots must carry inline datums");
}

const techAuthSigners = extractSignersFromCbor(techAuthDatum);
const councilSigners = extractSignersFromCbor(councilDatum);

function buildGovWitnesses(threshold: Contracts.MultisigThreshold) {
  const [techNum, techDenom, councilNum, councilDenom] = threshold;
  const techRequired = thresholdToRequiredSigners(
    techAuthSigners.length,
    techNum,
    techDenom,
    "mainnet snapshot threshold",
  );
  const councilRequired = thresholdToRequiredSigners(
    councilSigners.length,
    councilNum,
    councilDenom,
    "mainnet snapshot threshold",
  );

  return {
    techRequired,
    councilRequired,
    techNativeScript: createNativeMultisigScript(
      techRequired,
      techAuthSigners,
      NetworkId.Mainnet,
    ),
    councilNativeScript: createNativeMultisigScript(
      councilRequired,
      councilSigners,
      NetworkId.Mainnet,
    ),
  };
}

function govRedeemerData() {
  return serialize(Contracts.PermissionedRedeemer, {
    [techAuthSigners[0].paymentHash]: techAuthSigners[0].sr25519Key,
  });
}

function addGovernanceWitnesses(
  txBuilder: TxBuilder,
  threshold: Contracts.MultisigThreshold,
) {
  const { techNativeScript, councilNativeScript } =
    buildGovWitnesses(threshold);
  return txBuilder
    .addMint(
      PolicyId(techNativeScript.hash()),
      new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
    )
    .provideScript(Script.newNativeScript(techNativeScript))
    .addMint(
      PolicyId(councilNativeScript.hash()),
      new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
    )
    .provideScript(Script.newNativeScript(councilNativeScript));
}

function cloneUpgradeUtxo(
  utxo: TransactionUnspentOutput,
  datum: Contracts.UpgradeState,
  txHash: string,
  index = 0,
) {
  const output = utxo.output();
  const assets = output.amount().multiasset();

  return TransactionUnspentOutput.fromCore([
    {
      txId: TransactionId(txHash),
      index,
    },
    {
      address: PaymentAddress(output.address().toBech32()),
      value: {
        coins: output.amount().coin(),
        ...(assets ? { assets: new Map(assets) } : {}),
      },
      datum: serialize(Contracts.UpgradeState, datum).toCore(),
    },
  ]);
}

// Hand-built stage/promote transactions against mainnet snapshot UTxOs, validated by the deployed scripts in the emulator.
describe("Mainnet snapshot upgrade transactions", () => {
  test("reserve promote-auth via main authority inputs and preserves non-auth fields", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f0".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveMain);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveStaging);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        { balance: 0n },
      );

      const stagingInput = mainnetSnapshotUtxos.reserveStaging.input();
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "Auth",
        {
          Main: [
            {
              transaction_id: stagingInput.transactionId(),
              output_index: BigInt(stagingInput.index()),
            },
          ],
        },
      ]);
      const expectedMainState: Contracts.UpgradeState = [
        liveUpgradeStates.reserve.main[0],
        liveUpgradeStates.reserve.main[1],
        liveUpgradeStates.reserve.staging[2],
        liveUpgradeStates.reserve.main[3],
        liveUpgradeStates.reserve.main[4],
        liveUpgradeStates.reserve.main[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.reserveMain, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.reserveStaging)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(reserveTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.reserveMain.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.reserveMain
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedMainState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.main,
      );
      const { techRequired, councilRequired } = buildGovWitnesses(
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
      expect(techAuthSigners).toHaveLength(9);
      expect(councilSigners).toHaveLength(6);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("council stage-auth via main authority does not duplicate council main as a reference input", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f1".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.councilMain);
      emulator.addUtxo(mainnetSnapshotUtxos.councilStaging);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        { balance: 0n },
      );

      const mainInput = mainnetSnapshotUtxos.councilMain.input();
      const newAuthHash = "cd".repeat(28);
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "Auth",
        {
          Staging: [
            {
              transaction_id: mainInput.transactionId(),
              output_index: BigInt(mainInput.index()),
            },
            newAuthHash,
          ],
        },
      ]);
      const expectedStagingState: Contracts.UpgradeState = [
        liveUpgradeStates.council.staging[0],
        liveUpgradeStates.council.staging[1],
        newAuthHash,
        liveUpgradeStates.council.staging[3],
        liveUpgradeStates.council.staging[4] + 1n,
        liveUpgradeStates.council.staging[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.councilStaging, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.councilMain)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(councilTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.councilStaging
                  .output()
                  .address()
                  .toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.councilStaging
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [
                    AssetId(councilTwoStage.Script.hash() + STAGING_TOKEN_HEX),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedStagingState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.main,
      );
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("tech-auth stage-auth via staging authority references council main and uses staging threshold", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f2".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthMain);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthStaging);
      emulator.addUtxo(mainnetSnapshotUtxos.councilMain);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.stagingGovThreshold);
      emulator.accounts.set(
        createRewardAccount(stagingGovAuth.Script.hash(), NetworkId.Mainnet),
        {
          balance: 0n,
        },
      );

      const mainInput = mainnetSnapshotUtxos.techAuthMain.input();
      const newAuthHash = "cd".repeat(28);
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "Auth",
        {
          Staging: [
            {
              transaction_id: mainInput.transactionId(),
              output_index: BigInt(mainInput.index()),
            },
            newAuthHash,
          ],
        },
      ]);
      const expectedStagingState: Contracts.UpgradeState = [
        liveUpgradeStates.techAuth.staging[0],
        liveUpgradeStates.techAuth.staging[1],
        newAuthHash,
        liveUpgradeStates.techAuth.staging[3],
        liveUpgradeStates.techAuth.staging[4] + 1n,
        liveUpgradeStates.techAuth.staging[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.techAuthStaging, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthMain)
          .addReferenceInput(mainnetSnapshotUtxos.stagingGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilMain)
          .provideScript(techAuthTwoStage.Script)
          .provideScript(stagingGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(
              stagingGovAuth.Script.hash(),
              NetworkId.Mainnet,
            ),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.techAuthStaging
                  .output()
                  .address()
                  .toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.techAuthStaging
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [
                    AssetId(techAuthTwoStage.Script.hash() + STAGING_TOKEN_HEX),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedStagingState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.staging,
      );
      const { techRequired, councilRequired } = buildGovWitnesses(
        liveThresholds.staging,
      );
      expect(techRequired).toBe(5);
      expect(councilRequired).toBe(0);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("reserve stage-logic via staging authority references council main and uses staging threshold", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "fa".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveMain);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveStaging);
      emulator.addUtxo(mainnetSnapshotUtxos.councilMain);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.stagingGovThreshold);
      emulator.accounts.set(
        createRewardAccount(stagingGovAuth.Script.hash(), NetworkId.Mainnet),
        {
          balance: 0n,
        },
      );

      const mainInput = mainnetSnapshotUtxos.reserveMain.input();
      const newLogicHash = "cd".repeat(28);
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "Logic",
        {
          Staging: [
            {
              transaction_id: mainInput.transactionId(),
              output_index: BigInt(mainInput.index()),
            },
            newLogicHash,
          ],
        },
      ]);
      const expectedStagingState: Contracts.UpgradeState = [
        newLogicHash,
        liveUpgradeStates.reserve.staging[1],
        liveUpgradeStates.reserve.staging[2],
        liveUpgradeStates.reserve.staging[3],
        liveUpgradeStates.reserve.staging[4],
        liveUpgradeStates.reserve.staging[5] + 1n,
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.reserveStaging, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.reserveMain)
          .addReferenceInput(mainnetSnapshotUtxos.stagingGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilMain)
          .provideScript(reserveTwoStage.Script)
          .provideScript(stagingGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(
              stagingGovAuth.Script.hash(),
              NetworkId.Mainnet,
            ),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.reserveStaging
                  .output()
                  .address()
                  .toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.reserveStaging
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [
                    AssetId(reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedStagingState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.staging,
      );
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("reserve promote-logic via main authority copies staged logic and logic round", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "fb".repeat(32));
      const stagedLogicHash = "ce".repeat(28);
      const stagedReserveState: Contracts.UpgradeState = [
        stagedLogicHash,
        liveUpgradeStates.reserve.staging[1],
        liveUpgradeStates.reserve.staging[2],
        liveUpgradeStates.reserve.staging[3],
        liveUpgradeStates.reserve.staging[4],
        liveUpgradeStates.reserve.staging[5] + 1n,
      ];
      const stagedReserveUtxo = cloneUpgradeUtxo(
        mainnetSnapshotUtxos.reserveStaging,
        stagedReserveState,
        "b6".repeat(32),
      );

      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveMain);
      emulator.addUtxo(stagedReserveUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        {
          balance: 0n,
        },
      );

      const stagingInput = stagedReserveUtxo.input();
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "Logic",
        {
          Main: [
            {
              transaction_id: stagingInput.transactionId(),
              output_index: BigInt(stagingInput.index()),
            },
          ],
        },
      ]);
      const expectedMainState: Contracts.UpgradeState = [
        stagedReserveState[0],
        liveUpgradeStates.reserve.main[1],
        liveUpgradeStates.reserve.main[2],
        liveUpgradeStates.reserve.main[3],
        liveUpgradeStates.reserve.main[4],
        stagedReserveState[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.reserveMain, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(stagedReserveUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(reserveTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.reserveMain.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.reserveMain
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedMainState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.main,
      );
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("reserve stage-mitigation-logic via main authority updates only mitigation logic and round", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f6".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveMain);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveStaging);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        {
          balance: 0n,
        },
      );

      const mainInput = mainnetSnapshotUtxos.reserveMain.input();
      const newMitigationLogicHash = "cd".repeat(28);
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "MitigationLogic",
        {
          Staging: [
            {
              transaction_id: mainInput.transactionId(),
              output_index: BigInt(mainInput.index()),
            },
            newMitigationLogicHash,
          ],
        },
      ]);
      const expectedStagingState: Contracts.UpgradeState = [
        liveUpgradeStates.reserve.staging[0],
        newMitigationLogicHash,
        liveUpgradeStates.reserve.staging[2],
        liveUpgradeStates.reserve.staging[3],
        liveUpgradeStates.reserve.staging[4] + 1n,
        liveUpgradeStates.reserve.staging[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.reserveStaging, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.reserveMain)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(reserveTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.reserveStaging
                  .output()
                  .address()
                  .toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.reserveStaging
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [
                    AssetId(reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedStagingState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.main,
      );
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("reserve promote-mitigation-logic via main authority copies staged mitigation logic and round", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f7".repeat(32));
      const stagedMitigationLogicHash = "ce".repeat(28);
      const stagedReserveState: Contracts.UpgradeState = [
        liveUpgradeStates.reserve.staging[0],
        stagedMitigationLogicHash,
        liveUpgradeStates.reserve.staging[2],
        liveUpgradeStates.reserve.staging[3],
        liveUpgradeStates.reserve.staging[4] + 1n,
        liveUpgradeStates.reserve.staging[5],
      ];
      const stagedReserveUtxo = cloneUpgradeUtxo(
        mainnetSnapshotUtxos.reserveStaging,
        stagedReserveState,
        "a6".repeat(32),
      );

      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveMain);
      emulator.addUtxo(stagedReserveUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        {
          balance: 0n,
        },
      );

      const stagingInput = stagedReserveUtxo.input();
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "MitigationLogic",
        {
          Main: [
            {
              transaction_id: stagingInput.transactionId(),
              output_index: BigInt(stagingInput.index()),
            },
          ],
        },
      ]);
      const expectedMainState: Contracts.UpgradeState = [
        liveUpgradeStates.reserve.main[0],
        stagedMitigationLogicHash,
        liveUpgradeStates.reserve.main[2],
        liveUpgradeStates.reserve.main[3],
        stagedReserveState[4],
        liveUpgradeStates.reserve.main[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.reserveMain, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(stagedReserveUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(reserveTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.reserveMain.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.reserveMain
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedMainState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.main,
      );
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("reserve stage-mitigation-auth via main authority updates only mitigation auth and round", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f8".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveMain);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveStaging);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        {
          balance: 0n,
        },
      );

      const mainInput = mainnetSnapshotUtxos.reserveMain.input();
      const newMitigationAuthHash = "ef".repeat(28);
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "MitigationAuth",
        {
          Staging: [
            {
              transaction_id: mainInput.transactionId(),
              output_index: BigInt(mainInput.index()),
            },
            newMitigationAuthHash,
          ],
        },
      ]);
      const expectedStagingState: Contracts.UpgradeState = [
        liveUpgradeStates.reserve.staging[0],
        liveUpgradeStates.reserve.staging[1],
        liveUpgradeStates.reserve.staging[2],
        newMitigationAuthHash,
        liveUpgradeStates.reserve.staging[4] + 1n,
        liveUpgradeStates.reserve.staging[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.reserveStaging, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.reserveMain)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(reserveTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.reserveStaging
                  .output()
                  .address()
                  .toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.reserveStaging
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [
                    AssetId(reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedStagingState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.main,
      );
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("reserve promote-mitigation-auth via main authority copies staged mitigation auth and round", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f9".repeat(32));
      const stagedMitigationAuthHash = "fe".repeat(28);
      const stagedReserveState: Contracts.UpgradeState = [
        liveUpgradeStates.reserve.staging[0],
        liveUpgradeStates.reserve.staging[1],
        liveUpgradeStates.reserve.staging[2],
        stagedMitigationAuthHash,
        liveUpgradeStates.reserve.staging[4] + 1n,
        liveUpgradeStates.reserve.staging[5],
      ];
      const stagedReserveUtxo = cloneUpgradeUtxo(
        mainnetSnapshotUtxos.reserveStaging,
        stagedReserveState,
        "a7".repeat(32),
      );

      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveMain);
      emulator.addUtxo(stagedReserveUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        {
          balance: 0n,
        },
      );

      const stagingInput = stagedReserveUtxo.input();
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "MitigationAuth",
        {
          Main: [
            {
              transaction_id: stagingInput.transactionId(),
              output_index: BigInt(stagingInput.index()),
            },
          ],
        },
      ]);
      const expectedMainState: Contracts.UpgradeState = [
        liveUpgradeStates.reserve.main[0],
        liveUpgradeStates.reserve.main[1],
        liveUpgradeStates.reserve.main[2],
        stagedMitigationAuthHash,
        stagedReserveState[4],
        liveUpgradeStates.reserve.main[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.reserveMain, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(stagedReserveUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(reserveTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.reserveMain.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.reserveMain
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                expectedMainState,
              ).toCore(),
            }),
          )
          .setChangeAddress(addr),
        liveThresholds.main,
      );
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });
});

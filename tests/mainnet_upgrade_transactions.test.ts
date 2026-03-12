import {
  AssetId,
  AssetName,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  Script,
  Transaction,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
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
  mainnetReviewRefs,
  mainnetSnapshotUtxos,
  makeFundingUtxo,
  utxoRef,
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
const icsTwoStage =
  new Contracts.IlliquidCirculationSupplyIcsTwoStageUpgradeElse();

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

function txRefs(inputs: readonly { txId: string; index: number }[]) {
  return inputs.map((input) => `${input.txId}#${input.index}`);
}

function outputWithAsset(tx: Transaction, assetId: AssetId) {
  const output = tx
    .toCore()
    .body.outputs.find(
      (candidate) => (candidate.value.assets?.get(assetId) ?? 0n) === 1n,
    );
  if (!output?.datum) {
    throw new Error(`Missing output carrying ${assetId}`);
  }
  return output;
}

function expectUpgradeDatum(
  output: ReturnType<Transaction["toCore"]>["body"]["outputs"][number],
  expected: Contracts.UpgradeState,
) {
  const actual = PlutusData.fromCore(output.datum!);
  const expectedDatum = serialize(
    Contracts.UpgradeState,
    expected,
  ) as PlutusData;
  expect(actual.toCbor()).toBe(expectedDatum.toCbor());
}

function spendRedeemer(tx: Transaction) {
  const redeemers = tx.witnessSet().toCore().redeemers ?? [];
  const spend = redeemers.find(
    (redeemer) => String(redeemer.purpose).toLowerCase() === "spend",
  );
  if (!spend) {
    throw new Error("Missing spend redeemer");
  }
  return parse(Contracts.TwoStageRedeemer, PlutusData.fromCore(spend.data));
}

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

function draftTransaction(txBuilder: TxBuilder) {
  return Transaction.fromCbor(txBuilder.toCbor());
}

function expectGovernanceMultisigs(
  tx: Transaction,
  threshold: Contracts.MultisigThreshold,
) {
  const {
    techRequired,
    councilRequired,
    techNativeScript,
    councilNativeScript,
  } = buildGovWitnesses(threshold);
  const nativeScripts = tx.witnessSet().nativeScripts();
  const nativeScriptHashes = Array.from(nativeScripts?.values() ?? [])
    .map((script) => script.hash())
    .sort();

  expect(nativeScripts?.size() ?? 0).toBe(2);
  expect(nativeScriptHashes).toEqual(
    [techNativeScript.hash(), councilNativeScript.hash()].sort(),
  );

  const mint = tx.toCore().body.mint;
  expect(mint?.get(AssetId(techNativeScript.hash() + TECH_WITNESS_ASSET))).toBe(
    1n,
  );
  expect(
    mint?.get(AssetId(councilNativeScript.hash() + COUNCIL_WITNESS_ASSET)),
  ).toBe(1n);

  return { techRequired, councilRequired };
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

// These tests assert stage/promote transaction shape for mainnet snapshot-based upgrade flows, then validate the same builders in the emulator via the existing CLI multisig helpers.
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.reserveMain,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.reserveStaging,
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Auth",
        {
          Main: [
            {
              transaction_id: mainnetSnapshotUtxos.reserveStaging
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.reserveStaging.input().index(),
              ),
            },
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX),
        ),
        expectedMainState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
      expect(techAuthSigners).toHaveLength(9);
      expect(councilSigners).toHaveLength(6);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("tech-auth promote-auth via auth gov uses main authority inputs and preserves non-auth fields", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f5".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthMain);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthStaging);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        { balance: 0n },
      );

      const stagingInput = mainnetSnapshotUtxos.techAuthStaging.input();
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
        liveUpgradeStates.techAuth.main[0],
        liveUpgradeStates.techAuth.main[1],
        liveUpgradeStates.techAuth.staging[2],
        liveUpgradeStates.techAuth.main[3],
        liveUpgradeStates.techAuth.main[4],
        liveUpgradeStates.techAuth.main[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.techAuthMain, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthStaging)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(techAuthTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.techAuthMain.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.techAuthMain
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [
                    AssetId(techAuthTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                    1n,
                  ],
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.techAuthMain,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.techAuthStaging,
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Auth",
        {
          Main: [
            {
              transaction_id: mainnetSnapshotUtxos.techAuthStaging
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.techAuthStaging.input().index(),
              ),
            },
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(techAuthTwoStage.Script.hash() + MAIN_TOKEN_HEX),
        ),
        expectedMainState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
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
      const newAuthHash = liveUpgradeStates.council.main[2];
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.councilStaging,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.councilMain,
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Auth",
        {
          Staging: [
            {
              transaction_id: mainnetSnapshotUtxos.councilMain
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.councilMain.input().index(),
              ),
            },
            newAuthHash,
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(councilTwoStage.Script.hash() + STAGING_TOKEN_HEX),
        ),
        expectedStagingState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("tech-auth stage-auth via main authority uses main threshold without council-main reference", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f4".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthMain);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthStaging);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        { balance: 0n },
      );

      const mainInput = mainnetSnapshotUtxos.techAuthMain.input();
      const newAuthHash = liveUpgradeStates.techAuth.main[2];
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
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(techAuthTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
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
        liveThresholds.main,
      );
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.techAuthStaging,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.techAuthMain,
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Auth",
        {
          Staging: [
            {
              transaction_id: mainnetSnapshotUtxos.techAuthMain
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.techAuthMain.input().index(),
              ),
            },
            newAuthHash,
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(techAuthTwoStage.Script.hash() + STAGING_TOKEN_HEX),
        ),
        expectedStagingState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
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
      const newLogicHash = liveUpgradeStates.techAuth.main[2];
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "Auth",
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
        liveUpgradeStates.techAuth.staging[0],
        liveUpgradeStates.techAuth.staging[1],
        newLogicHash,
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.techAuthStaging,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.techAuthMain,
        mainnetReviewRefs.stagingGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
        mainnetReviewRefs.councilMain,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Auth",
        {
          Staging: [
            {
              transaction_id: mainnetSnapshotUtxos.techAuthMain
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.techAuthMain.input().index(),
              ),
            },
            newLogicHash,
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(techAuthTwoStage.Script.hash() + STAGING_TOKEN_HEX),
        ),
        expectedStagingState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.staging,
      );
      expect(techRequired).toBe(5);
      expect(councilRequired).toBe(0);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("ICS stage-auth via staging authority references council main and uses staging threshold", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "f3".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.icsMain);
      emulator.addUtxo(mainnetSnapshotUtxos.icsStaging);
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

      const mainInput = mainnetSnapshotUtxos.icsMain.input();
      const newLogicHash = liveUpgradeStates.ics.main[2];
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        "Auth",
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
        liveUpgradeStates.ics.staging[0],
        liveUpgradeStates.ics.staging[1],
        newLogicHash,
        liveUpgradeStates.ics.staging[3],
        liveUpgradeStates.ics.staging[4] + 1n,
        liveUpgradeStates.ics.staging[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.icsStaging, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.icsMain)
          .addReferenceInput(mainnetSnapshotUtxos.stagingGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilMain)
          .provideScript(icsTwoStage.Script)
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
                mainnetSnapshotUtxos.icsStaging.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.icsStaging.output().amount().coin(),
                assets: new Map([
                  [AssetId(icsTwoStage.Script.hash() + STAGING_TOKEN_HEX), 1n],
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.icsStaging,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.icsMain,
        mainnetReviewRefs.stagingGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
        mainnetReviewRefs.councilMain,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Auth",
        {
          Staging: [
            {
              transaction_id: mainnetSnapshotUtxos.icsMain
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.icsMain.input().index(),
              ),
            },
            newLogicHash,
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(icsTwoStage.Script.hash() + STAGING_TOKEN_HEX),
        ),
        expectedStagingState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
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
      const newLogicHash = liveUpgradeStates.reserve.main[0];
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
                mainnetSnapshotUtxos.reserveStaging.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.reserveStaging
                  .output()
                  .amount()
                  .coin(),
                assets: new Map([
                  [AssetId(reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX), 1n],
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.reserveStaging,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.reserveMain,
        mainnetReviewRefs.stagingGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
        mainnetReviewRefs.councilMain,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Logic",
        {
          Staging: [
            {
              transaction_id: mainnetSnapshotUtxos.reserveMain
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.reserveMain.input().index(),
              ),
            },
            newLogicHash,
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX),
        ),
        expectedStagingState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.staging,
      );
      expect(techRequired).toBe(5);
      expect(councilRequired).toBe(0);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("reserve promote-logic via main authority copies staged logic and logic round", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "fb".repeat(32));
      const stagedLogicHash = liveUpgradeStates.reserve.main[0];
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
                coins: mainnetSnapshotUtxos.reserveMain.output().amount().coin(),
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.reserveMain,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        utxoRef(stagedReserveUtxo),
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Logic",
        {
          Main: [
            {
              transaction_id: stagedReserveUtxo.input().transactionId(),
              output_index: BigInt(stagedReserveUtxo.input().index()),
            },
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX),
        ),
        expectedMainState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("ICS stage-logic via staging authority references council main and uses staging threshold", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "fc".repeat(32));
      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.icsMain);
      emulator.addUtxo(mainnetSnapshotUtxos.icsStaging);
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

      const mainInput = mainnetSnapshotUtxos.icsMain.input();
      const newLogicHash = liveUpgradeStates.ics.main[0];
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
        liveUpgradeStates.ics.staging[1],
        liveUpgradeStates.ics.staging[2],
        liveUpgradeStates.ics.staging[3],
        liveUpgradeStates.ics.staging[4],
        liveUpgradeStates.ics.staging[5] + 1n,
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.icsStaging, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.icsMain)
          .addReferenceInput(mainnetSnapshotUtxos.stagingGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilMain)
          .provideScript(icsTwoStage.Script)
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
                mainnetSnapshotUtxos.icsStaging.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.icsStaging.output().amount().coin(),
                assets: new Map([
                  [AssetId(icsTwoStage.Script.hash() + STAGING_TOKEN_HEX), 1n],
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.icsStaging,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.icsMain,
        mainnetReviewRefs.stagingGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
        mainnetReviewRefs.councilMain,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Logic",
        {
          Staging: [
            {
              transaction_id: mainnetSnapshotUtxos.icsMain
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.icsMain.input().index(),
              ),
            },
            newLogicHash,
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(icsTwoStage.Script.hash() + STAGING_TOKEN_HEX),
        ),
        expectedStagingState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.staging,
      );
      expect(techRequired).toBe(5);
      expect(councilRequired).toBe(0);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("ICS promote-logic via main authority copies staged logic and logic round", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "fd".repeat(32));
      const stagedLogicHash = liveUpgradeStates.ics.main[0];
      const stagedIcsState: Contracts.UpgradeState = [
        stagedLogicHash,
        liveUpgradeStates.ics.staging[1],
        liveUpgradeStates.ics.staging[2],
        liveUpgradeStates.ics.staging[3],
        liveUpgradeStates.ics.staging[4],
        liveUpgradeStates.ics.staging[5] + 1n,
      ];
      const stagedIcsUtxo = cloneUpgradeUtxo(
        mainnetSnapshotUtxos.icsStaging,
        stagedIcsState,
        "b7".repeat(32),
      );

      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.icsMain);
      emulator.addUtxo(stagedIcsUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.techAuthForever);
      emulator.addUtxo(mainnetSnapshotUtxos.councilForever);
      emulator.addUtxo(mainnetSnapshotUtxos.mainGovThreshold);
      emulator.accounts.set(
        createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
        {
          balance: 0n,
        },
      );

      const stagingInput = stagedIcsUtxo.input();
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
        stagedIcsState[0],
        liveUpgradeStates.ics.main[1],
        liveUpgradeStates.ics.main[2],
        liveUpgradeStates.ics.main[3],
        liveUpgradeStates.ics.main[4],
        stagedIcsState[5],
      ];

      const txBuilder = addGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(mainnetSnapshotUtxos.icsMain, redeemer)
          .addInput(fundingUtxo)
          .addReferenceInput(stagedIcsUtxo)
          .addReferenceInput(mainnetSnapshotUtxos.mainGovThreshold)
          .addReferenceInput(mainnetSnapshotUtxos.techAuthForever)
          .addReferenceInput(mainnetSnapshotUtxos.councilForever)
          .provideScript(icsTwoStage.Script)
          .provideScript(mainGovAuth.Script)
          .addWithdrawal(
            createRewardAccount(mainGovAuth.Script.hash(), NetworkId.Mainnet),
            0n,
            govRedeemerData(),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(
                mainnetSnapshotUtxos.icsMain.output().address().toBech32(),
              ),
              value: {
                coins: mainnetSnapshotUtxos.icsMain.output().amount().coin(),
                assets: new Map([
                  [AssetId(icsTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.icsMain,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        utxoRef(stagedIcsUtxo),
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "Logic",
        {
          Main: [
            {
              transaction_id: stagedIcsUtxo.input().transactionId(),
              output_index: BigInt(stagedIcsUtxo.input().index()),
            },
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(icsTwoStage.Script.hash() + MAIN_TOKEN_HEX),
        ),
        expectedMainState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.reserveStaging,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.reserveMain,
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "MitigationLogic",
        {
          Staging: [
            {
              transaction_id: mainnetSnapshotUtxos.reserveMain
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.reserveMain.input().index(),
              ),
            },
            newMitigationLogicHash,
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX),
        ),
        expectedStagingState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.reserveMain,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        utxoRef(stagedReserveUtxo),
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "MitigationLogic",
        {
          Main: [
            {
              transaction_id: stagedReserveUtxo.input().transactionId(),
              output_index: BigInt(stagedReserveUtxo.input().index()),
            },
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX),
        ),
        expectedMainState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.reserveStaging,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        mainnetReviewRefs.reserveMain,
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "MitigationAuth",
        {
          Staging: [
            {
              transaction_id: mainnetSnapshotUtxos.reserveMain
                .input()
                .transactionId(),
              output_index: BigInt(
                mainnetSnapshotUtxos.reserveMain.input().index(),
              ),
            },
            newMitigationAuthHash,
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX),
        ),
        expectedStagingState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
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
      const tx = draftTransaction(txBuilder);

      expect(txRefs(tx.toCore().body.inputs)).toEqual([
        mainnetReviewRefs.reserveMain,
        utxoRef(fundingUtxo),
      ]);
      expect(txRefs(tx.toCore().body.referenceInputs ?? [])).toEqual([
        utxoRef(stagedReserveUtxo),
        mainnetReviewRefs.mainGovThreshold,
        mainnetReviewRefs.techAuthForever,
        mainnetReviewRefs.councilForever,
      ]);
      expect(spendRedeemer(tx)).toEqual([
        "MitigationAuth",
        {
          Main: [
            {
              transaction_id: stagedReserveUtxo.input().transactionId(),
              output_index: BigInt(stagedReserveUtxo.input().index()),
            },
          ],
        },
      ]);
      expectUpgradeDatum(
        outputWithAsset(
          tx,
          AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX),
        ),
        expectedMainState,
      );

      const { techRequired, councilRequired } = expectGovernanceMultisigs(
        tx,
        liveThresholds.main,
      );
      expect(techRequired).toBe(6);
      expect(councilRequired).toBe(4);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });
});

import {
  Address,
  AssetId,
  Credential,
  CredentialType,
  NetworkId,
  PlutusData,
  RewardAccount,
  TransactionOutput,
  Value,
  type Transaction,
  type TransactionUnspentOutput,
  type Script,
} from "@blaze-cardano/core";
import { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import { describe, expect, test } from "bun:test";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import {
  cnightAssetId,
  liveUpgradeStates,
  mainnetSnapshotUtxos,
  makeFundingUtxo,
  makeImaginaryForeverUtxo,
} from "./helpers/mainnet-snapshot";

const reserveForever = new Contracts.ReserveReserveForeverElse();
const reserveLogic = new Contracts.ReserveReserveLogicElse();
const icsForever = new Contracts.IlliquidCirculationSupplyIcsForeverElse();
const icsLogic = new Contracts.IlliquidCirculationSupplyIcsLogicElse();

const randomAssetId = AssetId(
  "1234567890abcdef1234567890abcdef1234567890abcdef12345678" + "cafe",
);

function rewardAccount(scriptHash: string) {
  return RewardAccount.fromCredential(
    Credential.fromCore({
      hash: scriptHash,
      type: CredentialType.ScriptHash,
    }).toCore(),
    NetworkId.Testnet,
  );
}

function mergeValue(utxo1: TransactionUnspentOutput, utxo2: TransactionUnspentOutput) {
  const amount1 = utxo1.output().amount();
  const amount2 = utxo2.output().amount();
  return new Value(amount1.coin() + amount2.coin(), new Map([
    [
      cnightAssetId,
      (amount1.multiasset()?.get(cnightAssetId) ?? 0n) +
        (amount2.multiasset()?.get(cnightAssetId) ?? 0n),
    ],
  ]));
}

function contractOutput(tx: Transaction, address: string) {
  const output = tx.toCore().body.outputs.find((candidate) => candidate.address === address);
  if (!output) {
    throw new Error(`Missing contract output for ${address}`);
  }
  return output;
}

function sumAsset(
  outputs: ReturnType<Transaction["toCore"]>["body"]["outputs"],
  assetId: AssetId,
) {
  return outputs.reduce(
    (total, output) => total + (output.value.assets?.get(assetId) ?? 0n),
    0n,
  );
}

function buildMergeTx(args: {
  blaze: { newTransaction(): TxBuilder };
  walletAddress: string;
  foreverScript: Script;
  logicScript: Script;
  logicHash: string;
  twoStageMain: TransactionUnspentOutput;
  utxo1: TransactionUnspentOutput;
  utxo2: TransactionUnspentOutput;
  fundingUtxo: TransactionUnspentOutput;
}) {
  const mergedOutput = new TransactionOutput(
    args.utxo1.output().address(),
    mergeValue(args.utxo1, args.utxo2),
  );
  const utxo1Datum = args.utxo1.output().datum();
  if (!utxo1Datum) {
    throw new Error("Imaginary merge UTxO is missing datum");
  }
  mergedOutput.setDatum(utxo1Datum);

  return args.blaze
    .newTransaction()
    .addInput(args.utxo1, PlutusData.newInteger(0n))
    .addInput(args.utxo2, PlutusData.newInteger(0n))
    .addInput(args.fundingUtxo)
    .addReferenceInput(args.twoStageMain)
    .addWithdrawal(rewardAccount(args.logicHash), 0n, PlutusData.newInteger(0n))
    .provideScript(args.foreverScript)
    .provideScript(args.logicScript)
    .addOutput(mergedOutput)
    .setChangeAddress(Address.fromBech32(args.walletAddress))
    .setFeePadding(50_000n);
}

describe("Mainnet snapshot merge transactions", () => {
  test("reserve merge keeps ADA+cNIGHT in contract output and returns random token to change", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "e0".repeat(32));
      const reserveInput1 = makeImaginaryForeverUtxo({
        script: reserveForever.Script,
        txHash: "e1".repeat(32),
        txIndex: 0,
        coins: 5_000_000n,
        cnightAmount: 1n,
        randomAssetId,
        randomAmount: 7n,
      });
      const reserveInput2 = makeImaginaryForeverUtxo({
        script: reserveForever.Script,
        txHash: "e2".repeat(32),
        txIndex: 1,
        coins: 7_000_000n,
        cnightAmount: 2n,
        randomAssetId,
        randomAmount: 11n,
      });

      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.reserveMain);
      emulator.addUtxo(reserveInput1);
      emulator.addUtxo(reserveInput2);
      emulator.accounts.set(rewardAccount(liveUpgradeStates.reserve.main[0]), {
        balance: 0n,
      });

      const inspectTx = await buildMergeTx({
        blaze,
        walletAddress: addr.toBech32(),
        foreverScript: reserveForever.Script,
        logicScript: reserveLogic.Script,
        logicHash: liveUpgradeStates.reserve.main[0],
        twoStageMain: mainnetSnapshotUtxos.reserveMain,
        utxo1: reserveInput1,
        utxo2: reserveInput2,
        fundingUtxo,
      }).complete();

      const mergedContractOutput = contractOutput(
        inspectTx,
        reserveInput1.output().address().toBech32(),
      );
      expect(mergedContractOutput.value.coins).toBe(12_000_000n);
      expect(mergedContractOutput.value.assets?.get(cnightAssetId)).toBe(3n);
      expect(mergedContractOutput.value.assets?.has(randomAssetId) ?? false).toBe(false);

      const walletOutputs = inspectTx
        .toCore()
        .body.outputs.filter((candidate) => candidate.address === addr.toBech32());
      expect(sumAsset(walletOutputs, randomAssetId)).toBe(18n);
      expect(sumAsset(walletOutputs, cnightAssetId)).toBe(0n);

      await emulator.expectValidTransaction(
        blaze,
        buildMergeTx({
          blaze,
          walletAddress: addr.toBech32(),
          foreverScript: reserveForever.Script,
          logicScript: reserveLogic.Script,
          logicHash: liveUpgradeStates.reserve.main[0],
          twoStageMain: mainnetSnapshotUtxos.reserveMain,
          utxo1: reserveInput1,
          utxo2: reserveInput2,
          fundingUtxo,
        }),
      );
    });
  });

  test("ICS merge keeps ADA+cNIGHT in contract output and returns random token to change", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = makeFundingUtxo(addr, "e3".repeat(32));
      const icsInput1 = makeImaginaryForeverUtxo({
        script: icsForever.Script,
        txHash: "e4".repeat(32),
        txIndex: 0,
        coins: 4_000_000n,
        cnightAmount: 1n,
        randomAssetId,
        randomAmount: 7n,
      });
      const icsInput2 = makeImaginaryForeverUtxo({
        script: icsForever.Script,
        txHash: "e5".repeat(32),
        txIndex: 1,
        coins: 9_000_000n,
        cnightAmount: 2n,
        randomAssetId,
        randomAmount: 11n,
      });

      emulator.addUtxo(fundingUtxo);
      emulator.addUtxo(mainnetSnapshotUtxos.icsMain);
      emulator.addUtxo(icsInput1);
      emulator.addUtxo(icsInput2);
      emulator.accounts.set(rewardAccount(liveUpgradeStates.ics.main[0]), {
        balance: 0n,
      });

      const inspectTx = await buildMergeTx({
        blaze,
        walletAddress: addr.toBech32(),
        foreverScript: icsForever.Script,
        logicScript: icsLogic.Script,
        logicHash: liveUpgradeStates.ics.main[0],
        twoStageMain: mainnetSnapshotUtxos.icsMain,
        utxo1: icsInput1,
        utxo2: icsInput2,
        fundingUtxo,
      }).complete();

      const mergedContractOutput = contractOutput(
        inspectTx,
        icsInput1.output().address().toBech32(),
      );
      expect(mergedContractOutput.value.coins).toBe(13_000_000n);
      expect(mergedContractOutput.value.assets?.get(cnightAssetId)).toBe(3n);
      expect(mergedContractOutput.value.assets?.has(randomAssetId) ?? false).toBe(false);

      const walletOutputs = inspectTx
        .toCore()
        .body.outputs.filter((candidate) => candidate.address === addr.toBech32());
      expect(sumAsset(walletOutputs, randomAssetId)).toBe(18n);
      expect(sumAsset(walletOutputs, cnightAssetId)).toBe(0n);

      await emulator.expectValidTransaction(
        blaze,
        buildMergeTx({
          blaze,
          walletAddress: addr.toBech32(),
          foreverScript: icsForever.Script,
          logicScript: icsLogic.Script,
          logicHash: liveUpgradeStates.ics.main[0],
          twoStageMain: mainnetSnapshotUtxos.icsMain,
          utxo1: icsInput1,
          utxo2: icsInput2,
          fundingUtxo,
        }),
      );
    });
  });
});

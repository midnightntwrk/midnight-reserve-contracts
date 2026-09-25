import {
  type Address,
  AssetId,
  NetworkId,
  type Script,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Emulator } from "@blaze-cardano/emulator";
import type { Blaze, Provider, Wallet } from "@blaze-cardano/sdk";
import { describe, expect, test } from "bun:test";
import { Either } from "effect";
import { buildMergeTx } from "../cli/governance/merge-utxos";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import {
  cnightAssetId,
  liveUpgradeStates,
  mainnetSnapshotUtxos,
  makeImaginaryForeverUtxo,
} from "./helpers/mainnet-snapshot";
import { registerRewardAccount, asFunded } from "./helpers/fixtures";
import { leftOf } from "./helpers/effect";

const reserveForever = new Contracts.ReserveReserveForeverElse();
const reserveLogic = new Contracts.ReserveReserveLogicElse();
const icsForever = new Contracts.IlliquidCirculationSupplyIcsForeverElse();
const icsLogic = new Contracts.IlliquidCirculationSupplyIcsLogicElse();

const randomAssetId = AssetId(
  "1234567890abcdef1234567890abcdef1234567890abcdef12345678" + "cafe",
);

interface Family {
  readonly forever: Script;
  readonly logic: Script;
  readonly twoStageMain: TransactionUnspentOutput;
  readonly mainState: Contracts.UpgradeState;
}
const reserve: Family = {
  forever: reserveForever.Script,
  logic: reserveLogic.Script,
  twoStageMain: mainnetSnapshotUtxos.reserveMain,
  mainState: liveUpgradeStates.reserve.main,
};
const ics: Family = {
  forever: icsForever.Script,
  logic: icsLogic.Script,
  twoStageMain: mainnetSnapshotUtxos.icsMain,
  mainState: liveUpgradeStates.ics.main,
};

/** Two imaginary forever UTxOs with ADA, cNIGHT and a stray asset; the fee UTxO pays. */
const seed = (
  emulator: Emulator,
  fundingUtxo: TransactionUnspentOutput,
  family: Family,
  cnight: readonly [bigint, bigint] = [1n, 2n],
) => {
  const utxo1 = makeImaginaryForeverUtxo({
    script: family.forever,
    txHash: "e1".repeat(32),
    txIndex: 0,
    coins: 5_000_000n,
    cnightAmount: cnight[0],
    randomAssetId,
    randomAmount: 7n,
  });
  const utxo2 = makeImaginaryForeverUtxo({
    script: family.forever,
    txHash: "e2".repeat(32),
    txIndex: 1,
    coins: 7_000_000n,
    cnightAmount: cnight[1],
    randomAssetId,
    randomAmount: 11n,
  });
  for (const utxo of [family.twoStageMain, utxo1, utxo2])
    emulator.addUtxo(utxo);
  registerRewardAccount(emulator, family.mainState[0]);
  return { fundingUtxo, utxo1, utxo2 };
};

const merge = (
  blaze: Blaze<Provider, Wallet>,
  addr: Address,
  family: Family,
  utxos: ReturnType<typeof seed>,
  logicScript: Script = family.logic,
  asset: AssetId = cnightAssetId,
) =>
  buildMergeTx(
    blaze,
    {
      forever: family.forever,
      utxo1: utxos.utxo1,
      utxo2: utxos.utxo2,
      twoStageMainUtxo: family.twoStageMain,
      userUtxo: utxos.fundingUtxo,
      logicScript,
      logicRound: Number(family.mainState[5]),
    },
    {
      cnightAssetId: asset,
      networkId: NetworkId.Testnet,
      changeAddress: addr,
      feePadding: 0n,
    },
  );

// The CLI builder against mainnet snapshot two-stage states, validated by the deployed scripts in the emulator.
describe("Mainnet snapshot merge transactions", () => {
  test.each([
    ["reserve", reserve],
    ["ICS", ics],
  ] as const)(
    "%s merge that keeps only ADA+cNIGHT in the contract output validates",
    async (_, family) => {
      await asFunded(async (emulator, blaze, addr, fee) => {
        const utxos = seed(emulator, fee, family);
        await emulator.expectValidTransaction(
          blaze,
          Either.getOrThrow(merge(blaze, addr, family, utxos)),
        );
        const merged = emulator
          .utxos()
          .find(
            (u) => u.output().amount().multiasset()?.get(cnightAssetId) === 3n,
          );
        expect(merged?.output().amount().coin()).toBe(12_000_000n);
      });
    },
  );

  test("a withdrawal through the wrong logic is rejected", async () => {
    await asFunded(async (emulator, blaze, addr, fee) => {
      const utxos = seed(emulator, fee, reserve);
      registerRewardAccount(emulator, icsLogic.Script.hash());
      await emulator.expectScriptFailure(
        Either.getOrThrow(merge(blaze, addr, reserve, utxos, icsLogic.Script)),
        /Spend\[\d+\]|Withdraw\[0\]/,
      );
    });
  });

  test("a merge output that drops cNIGHT for another asset is rejected", async () => {
    await asFunded(async (emulator, blaze, addr, fee) => {
      const utxos = seed(emulator, fee, reserve);
      await emulator.expectScriptFailure(
        Either.getOrThrow(
          merge(blaze, addr, reserve, utxos, reserve.logic, randomAssetId),
        ),
        /Spend\[\d+\]|Withdraw\[0\]/,
      );
    });
  });

  test("two UTxOs without cNIGHT cannot be merged", async () => {
    await asFunded(async (emulator, blaze, addr, fee) => {
      const utxos = seed(emulator, fee, reserve, [0n, 0n]);
      const result = merge(blaze, addr, reserve, utxos);
      expect(leftOf(result)).toMatchObject({
        _tag: "PreconditionFailed",
        refusal: { _tag: "NoCnight" },
      });
    });
  });
});

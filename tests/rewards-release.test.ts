/**
 * The reserve release (docs/rewards/spec.md §8): the plan against the
 * off-chain ceiling vectors reserve_v2.test.ak also checks, and the
 * rewards-release program end to end in the emulator, over a reserve whose
 * main logic is reserve_logic_v2 (the state after its promotion) and a
 * deployed rewards pool.
 */
import { describe, expect, test } from "bun:test";
import {
  addressFromValidator,
  AssetId,
  NetworkId,
  PaymentAddress,
  PlutusData,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import { Effect, Either, Layer, Option } from "effect";
import * as Contracts from "../contract_blueprint";
import { ProviderOver } from "../cli/chain/provider";
import type { ReleaseSchedule } from "../cli/config/settings";
import { Blueprint, BlueprintLive } from "../cli/contracts/contracts";
import { buildTwoStageDeploymentTx } from "../cli/deploy/builders";
import { DEPLOY_STEPS, type DeployInput } from "../cli/deploy/deploy";
import {
  lastReleaseTime,
  releaseCeiling,
  releasePlan,
  releaseTx,
} from "../cli/rewards/release";
import {
  buildInstances,
  captureOutput,
  emulatorProfile,
  expectFailure,
  OutputCaptured,
  PlatformLive,
  runTest,
  SettingsWith,
} from "./helpers/effect";
import {
  addCollateral,
  councilSigners,
  FEE_TX,
  feeUtxo,
  randomHash,
  registerRewardAccount,
  techAuthSigners,
} from "./helpers/fixtures";

const schedule: ReleaseSchedule = {
  intervalMs: 60_000n,
  factorNum: 159_817_340_105n,
  factorDen: 10n ** 18n,
};

const RESERVE = 1_000_000_000_000n;

describe("releaseCeiling", () => {
  test("matches the off-chain vectors for one, two and three intervals", () => {
    expect(
      [1n, 2n, 3n].map((n) => releaseCeiling(RESERVE, n, schedule)),
    ).toEqual([159_818n, 319_636n, 479_454n]);
  });
});

describe("releasePlan", () => {
  test("nothing before a whole interval", () => {
    expect(releasePlan(RESERVE, 0n, 60_000n, 119_999n, schedule)).toEqual(
      Option.none(),
    );
  });

  test("the whole intervals elapsed, the pool filled to their ceiling", () => {
    expect(releasePlan(RESERVE, 0n, 60_000n, 250_000n, schedule)).toEqual(
      Option.some({ intervals: 3n, released: 479_454n, next: 240_000n }),
    );
  });

  test("net of what the pool holds", () => {
    expect(
      Option.map(
        releasePlan(RESERVE, 100_000n, 0n, 60_000n, schedule),
        (p) => p.released,
      ),
    ).toEqual(Option.some(59_818n));
  });

  test("a backlog is covered MAX_RELEASE_INTERVALS at a time", () => {
    expect(
      Option.map(
        releasePlan(RESERVE, 0n, 0n, 1_000n * 60_000n, schedule),
        (p) => [p.intervals, p.next],
      ),
    ).toEqual(Option.some([240n, 240n * 60_000n]));
  });

  test("a pool above the ceiling releases nothing and still advances time", () => {
    expect(releasePlan(RESERVE, 200_000n, 0n, 60_000n, schedule)).toEqual(
      Option.some({ intervals: 1n, released: 0n, next: 60_000n }),
    );
  });
});

describe("lastReleaseTime", () => {
  const constr = (alternative: bigint, fields: bigint[]) =>
    PlutusData.fromCore({
      constructor: alternative,
      fields: {
        items: fields.map((f) => PlutusData.newInteger(f).toCore()),
      },
    });

  test("a Releasing state gives its time", () => {
    expect(lastReleaseTime(constr(1n, [180_000n, 5n]))).toEqual(
      Either.right(180_000n),
    );
  });

  test("the deploy datum Constr 0 [0, 0] has not started releasing", () => {
    expect(Either.isLeft(lastReleaseTime(constr(0n, [0n, 0n])))).toBe(true);
  });

  test("anything else is refused", () => {
    expect(Either.isLeft(lastReleaseTime(constr(1n, [1n])))).toBe(true);
  });
});

describe("rewards-release in the emulator", async () => {
  const emulator = new Emulator([]);
  const [blaze, wallet] = await emulator.as(
    "wallet",
    async (b, a) => [b, a] as const,
  );
  emulator.addUtxo(feeUtxo(wallet, FEE_TX));
  const layer = Layer.mergeAll(
    SettingsWith("emulator", { DEPLOYER_ADDRESS: wallet.toBech32() }),
    BlueprintLive("emulator", "build"),
    ProviderOver(new EmulatorProvider(emulator)),
    PlatformLive,
    OutputCaptured(captureOutput()),
  );
  const profile = await emulatorProfile();
  const contracts = await buildInstances();
  const networkId = NetworkId.Testnet;
  const params = {
    networkId,
    coinsPerUtxoByte: emulator.params.coinsPerUtxoByte,
    collateral: addCollateral(emulator, wallet),
  };
  const { reserve, releaseLogic } = await runTest(
    layer,
    Effect.flatMap(Blueprint, (b) =>
      Effect.all({
        reserve: b.twoStage("reserve"),
        releaseLogic: b.optional("reserveLogicV2"),
      }),
    ),
  );

  emulator.stepForwardToUnix(Date.now());
  const interval = profile.release.intervalMs;
  // Two whole intervals before the program's validity start (a minute before now), with half an interval to spare.
  const last = BigInt(Date.now()) - 60_000n - (5n * interval) / 2n;

  const reserveOneShot = feeUtxo(
    wallet,
    profile.reserve_one_shot_hash,
    profile.reserve_one_shot_index,
  );
  emulator.addUtxo(reserveOneShot);
  await emulator.expectValidTransaction(
    blaze,
    buildTwoStageDeploymentTx(
      blaze,
      {
        oneShotUtxo: reserveOneShot,
        twoStage: reserve.twoStage.Script,
        forever: reserve.forever.Script,
        logic: releaseLogic.Script,
        govAuth: contracts.govAuth.Script,
        stagingGovAuth: contracts.stagingGovAuth.Script,
        foreverDatum: serialize(Contracts.ReleaseState, {
          Releasing: { last_release_time: last, reserve_floor: 0n },
        }),
        foreverRedeemer: PlutusData.newInteger(0n),
        registerLogic: false,
      },
      params,
    ),
  );
  registerRewardAccount(emulator, releaseLogic.Script.hash());

  const deployInput: DeployInput = {
    network: "emulator",
    outputDir: "/tmp/rewards-release",
    techAuthThreshold: { numerator: 2n, denominator: 3n },
    councilThreshold: { numerator: 2n, denominator: 3n },
    councilStagingThreshold: { numerator: 0n, denominator: 1n },
    techAuthStagingThreshold: { numerator: 1n, denominator: 2n },
    bridgeThreshold: { numerator: 2n, denominator: 3n },
    components: Option.none(),
  };
  const poolStep = DEPLOY_STEPS["rewards-pool"];
  const poolOneShots = poolStep.oneShots(profile).map(([hash, index]) => {
    const utxo = feeUtxo(wallet, hash, index);
    emulator.addUtxo(utxo);
    return utxo;
  });
  await emulator.expectValidTransaction(
    blaze,
    await runTest(
      layer,
      poolStep.build(
        {
          input: deployInput,
          config: profile,
          contracts,
          deployer: wallet.toBech32(),
          techAuthSigners,
          councilSigners,
          blaze,
          params,
          maxTxSize: emulator.params.maxTxSize,
        },
        poolOneShots,
      ),
    ),
  );

  const night = AssetId(
    profile.cnight_policy + Buffer.from(profile.cnight_name).toString("hex"),
  );
  emulator.addUtxo(
    new TransactionUnspentOutput(
      new TransactionInput(TransactionId(randomHash(32)), 0n),
      TransactionOutput.fromCore({
        address: PaymentAddress(
          addressFromValidator(networkId, reserve.forever.Script).toBech32(),
        ),
        value: { coins: 5_000_000n, assets: new Map([[night, RESERVE]]) },
        datum: PlutusData.fromCore({
          constructor: 0n,
          fields: { items: [] },
        }).toCore(),
      }),
    ),
  );

  const poolForever = await runTest(
    layer,
    Effect.map(
      Effect.flatMap(Blueprint, (b) => b.twoStage("rewards-pool")),
      (t) => t.forever.Script,
    ),
  );
  const nightAt = (script: typeof poolForever) =>
    emulator
      .utxos()
      .filter(
        (u) =>
          u.output().address().toBech32() ===
          addressFromValidator(networkId, script).toBech32(),
      )
      .reduce(
        (sum, u) => sum + (u.output().amount().multiasset()?.get(night) ?? 0n),
        0n,
      );

  test("releases the two elapsed intervals into the pool and advances the reserve's time", async () => {
    const tx = await runTest(layer, releaseTx("emulator"));
    const signed = await blaze.signTransaction(tx);
    emulator.awaitTransactionConfirmation(
      await emulator.submitTransaction(signed),
    );
    emulator.stepForwardBlock();
    expect(nightAt(poolForever)).toBe(319_636n);
    expect(nightAt(reserve.forever.Script)).toBe(RESERVE - 319_636n);
    const nft = emulator
      .utxos()
      .find(
        (u) =>
          (u
            .output()
            .amount()
            .multiasset()
            ?.get(AssetId(reserve.forever.Script.hash())) ?? 0n) === 1n,
      );
    expect(nft?.output().datum()?.asInlineData()?.toCbor()).toBe(
      serialize(Contracts.ReleaseState, {
        Releasing: {
          last_release_time: last + 2n * interval,
          reserve_floor: RESERVE - 319_636n,
        },
      }).toCbor(),
    );
  });

  test("a second release in the same interval is not due", async () => {
    const error = await expectFailure(
      layer,
      releaseTx("emulator"),
      "PreconditionFailed",
    );
    expect(error.refusal._tag).toBe("ReleaseNotDue");
  });
});

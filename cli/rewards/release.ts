/**
 * rewards-release: the reserve's timed release into the rewards pool
 * (docs/rewards/spec.md §8), built unsigned for the deployer. The plan is
 * the one reserve_logic_v2 checks: the whole intervals elapsed since the
 * reserve NFT's last_release_time, and the pool filled to the ceiling of
 * those intervals net of what it holds. The transaction spends the reserve
 * NFT, every reserve value UTxO and every pool value UTxO, withdraws
 * through the reserve's running logic (Release) and the pool's (Receive),
 * and its validity starts a minute before now, so a devnet tip behind the
 * clock still admits it.
 */
import {
  addressFromValidator,
  AssetId,
  type NetworkId,
  PlutusData,
  type Script,
  type Slot,
  TransactionOutput,
  type TransactionUnspentOutput,
  PaymentAddress,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import { calculateMinAda, type TxBuilder } from "@blaze-cardano/tx";
import { Clock, Effect, Either, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import { buildTx } from "../chain/complete-tx";
import {
  contractUtxos,
  upgradeScripts,
  upgradeStateAt,
} from "../chain/governance-provider";
import { Provider, slotConfig } from "../chain/provider";
import { DEPLOYER_ONLY, withdrawThroughLogic } from "../chain/transaction";
import { writeTransaction } from "../chain/tx-file";
import { type Environment, environmentOf } from "../config/network-mapping";
import { type ReleaseSchedule, Settings } from "../config/settings";
import { Blueprint } from "../contracts/contracts";
import { DatumParseError, PreconditionFailed } from "../errors";
import { type TxFileInput, txFilePath } from "../input";
import { Output } from "../output";

/** How far before now the validity starts. */
const VALIDITY_MARGIN_MS = 60_000n;

/** The most intervals one release covers; reserve_logic_v2 steps the ceiling once per interval, and a backlog catches up over several releases. */
export const MAX_RELEASE_INTERVALS = 240n;

/** One release: the intervals it covers, the NIGHT it moves, and the new last_release_time. */
export interface ReleasePlan {
  readonly intervals: bigint;
  readonly released: bigint;
  readonly next: bigint;
}

/** The pool ceiling after `intervals` steps of the release factor, each rounded up. */
export const releaseCeiling = (
  reserve: bigint,
  intervals: bigint,
  schedule: ReleaseSchedule,
): bigint => {
  let ceiling = 0n;
  for (let step = 0n; step < intervals; step++) {
    ceiling +=
      ((reserve - ceiling) * schedule.factorNum + schedule.factorDen - 1n) /
      schedule.factorDen;
  }
  return ceiling;
};

/** last_release_time of the reserve NFT's datum: the deploy datum's two fields mean no release yet. */
export const lastReleaseTime = (
  datum: PlutusData,
  schedule: ReleaseSchedule,
): Either.Either<bigint, string> => {
  const fields = datum.asConstrPlutusData()?.getData();
  if (fields?.getLength() === 2) return Either.right(schedule.t0Ms);
  const time =
    fields?.getLength() === 1 ? fields.get(0).asInteger() : undefined;
  return time === undefined
    ? Either.left(
        `${datum.toCbor()} is neither the deploy datum nor a ReleaseState`,
      )
    : Either.right(time);
};

/** The release due at `now` from `reserve` into `pool` NIGHT, or none before a whole interval has passed. */
export const releasePlan = (
  reserve: bigint,
  pool: bigint,
  last: bigint,
  now: bigint,
  schedule: ReleaseSchedule,
): Option.Option<ReleasePlan> => {
  const elapsed = now < last ? 0n : (now - last) / schedule.intervalMs;
  if (elapsed < 1n) return Option.none();
  const intervals =
    elapsed < MAX_RELEASE_INTERVALS ? elapsed : MAX_RELEASE_INTERVALS;
  const ceiling = releaseCeiling(reserve, intervals, schedule);
  const released = ceiling > pool ? ceiling - pool : 0n;
  return Option.some({
    intervals,
    released: released < reserve ? released : reserve,
    next: last + intervals * schedule.intervalMs,
  });
};

/** What a release spends and references. */
export interface ReleaseInputs {
  readonly reserveForever: Script;
  readonly reserveLogic: Script;
  readonly reserveMitigation: Option.Option<Script>;
  readonly reserveMain: TransactionUnspentOutput;
  readonly nftUtxo: TransactionUnspentOutput;
  readonly reserveUtxos: readonly TransactionUnspentOutput[];
  readonly poolForever: Script;
  readonly poolLogic: Script;
  readonly poolMitigation: Option.Option<Script>;
  readonly poolMain: TransactionUnspentOutput;
  readonly poolUtxos: readonly TransactionUnspentOutput[];
  readonly night: AssetId;
  readonly plan: ReleasePlan;
  readonly validFrom: Slot;
}

const lovelaceIn = (utxos: readonly TransactionUnspentOutput[]) =>
  utxos.reduce((sum, u) => sum + u.output().amount().coin(), 0n);

const nightIn = (utxos: readonly TransactionUnspentOutput[], night: AssetId) =>
  utxos.reduce(
    (sum, u) => sum + (u.output().amount().multiasset()?.get(night) ?? 0n),
    0n,
  );

/** The inline datum of the value outputs: the unit constructor (an integer's core form is a bare bigint, which fromCore drops when 0). */
const UNIT = PlutusData.fromCore({ constructor: 0n, fields: { items: [] } });

/** A `[ada, night]` output at the script's address with an inline datum, at least its min ADA. */
const nightOutput = (
  script: Script,
  networkId: NetworkId,
  lovelace: bigint,
  night: AssetId,
  amount: bigint,
  coinsPerUtxoByte: number,
): TransactionOutput => {
  const output = TransactionOutput.fromCore({
    address: PaymentAddress(addressFromValidator(networkId, script).toBech32()),
    value: { coins: lovelace, assets: new Map([[night, amount]]) },
    datum: UNIT.toCore(),
  });
  const min = calculateMinAda(output, coinsPerUtxoByte);
  if (lovelace < min) output.amount().setCoin(min);
  return output;
};

/** The release transaction over the plan: the reserve NFT with its new time, the reserve less the release, the pool plus it. */
export const buildReleaseTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: ReleaseInputs,
  networkId: NetworkId,
  coinsPerUtxoByte: number,
): TxBuilder => {
  const { plan, night } = inputs;
  const unread = PlutusData.newInteger(0n);
  const spend = (tx: TxBuilder, utxos: readonly TransactionUnspentOutput[]) =>
    utxos.reduce((t, utxo) => t.addInput(utxo, unread), tx);
  const withReserve = spend(
    blaze
      .newTransaction()
      .addReferenceInput(inputs.reserveMain)
      .addReferenceInput(inputs.poolMain)
      .setValidFrom(inputs.validFrom),
    [inputs.nftUtxo, ...inputs.reserveUtxos],
  ).provideScript(inputs.reserveForever);
  const released = withdrawThroughLogic(
    withReserve,
    inputs.reserveLogic,
    inputs.reserveMitigation,
    serialize(Contracts.ReserveRedeemer, {
      Release: { intervals: plan.intervals },
    }),
    networkId,
  );
  const withPool =
    inputs.poolUtxos.length === 0
      ? released
      : withdrawThroughLogic(
          spend(released, inputs.poolUtxos).provideScript(inputs.poolForever),
          inputs.poolLogic,
          inputs.poolMitigation,
          serialize(Contracts.PoolRedeemer, "Receive"),
          networkId,
        );
  const nft = inputs.nftUtxo.output();
  return withPool
    .addOutput(
      TransactionOutput.fromCore({
        ...nft.toCore(),
        datum: serialize(Contracts.ReleaseState, {
          last_release_time: plan.next,
        }).toCore(),
      }),
    )
    .addOutput(
      nightOutput(
        inputs.reserveForever,
        networkId,
        lovelaceIn(inputs.reserveUtxos),
        night,
        nightIn(inputs.reserveUtxos, night) - plan.released,
        coinsPerUtxoByte,
      ),
    )
    .addOutput(
      nightOutput(
        inputs.poolForever,
        networkId,
        lovelaceIn(inputs.poolUtxos),
        night,
        nightIn(inputs.poolUtxos, night) + plan.released,
        coinsPerUtxoByte,
      ),
    );
};

const hasNft = (utxo: TransactionUnspentOutput, policy: string) =>
  [...(utxo.output().amount().multiasset()?.keys() ?? [])].some((id) =>
    id.startsWith(policy),
  );

/** The release due now on `network`, built unsigned; ReleaseNotDue before a whole interval has passed. */
export const releaseTx = (network: Environment) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const { networkId } = environmentOf(network);
    const config = yield* Effect.flatMap(Settings, (s) => s.profile);
    const blueprint = yield* Blueprint;
    const reserve = yield* blueprint.twoStage("reserve");
    const pool = yield* blueprint.twoStage("rewards-pool");
    const releaseLogic = yield* blueprint.optional("reserveLogicV2");
    const found = yield* contractUtxos(
      {
        reserveForever: reserve.forever.Script,
        reserveTwoStage: reserve.twoStage.Script,
        poolForever: pool.forever.Script,
        poolTwoStage: pool.twoStage.Script,
      },
      networkId,
    );
    const nftUtxo = yield* found.nft("reserveForever");
    const reserveMain = yield* found.main("reserveTwoStage");
    const poolMain = yield* found.main("poolTwoStage");
    const reserveState = yield* upgradeStateAt(reserveMain);
    if (reserveState.logicHash !== releaseLogic.Script.hash()) {
      return yield* new PreconditionFailed({
        command: "rewards-release",
        refusal: {
          _tag: "ReserveNotOnRelease",
          logicHash: reserveState.logicHash,
          releaseLogicHash: releaseLogic.Script.hash(),
        },
      });
    }
    const reserveScripts = yield* upgradeScripts(
      reserveState,
      releaseLogic.Script.hash(),
    );
    const poolState = yield* upgradeStateAt(poolMain);
    const poolScripts = yield* upgradeScripts(
      poolState,
      pool.logic.Script.hash(),
    );
    const reserveUtxos = found
      .at("reserveForever")
      .filter((u) => !hasNft(u, reserve.forever.Script.hash()));
    const poolUtxos = found
      .at("poolForever")
      .filter((u) => !hasNft(u, pool.forever.Script.hash()));
    const night = AssetId(
      config.cnight_policy + Buffer.from(config.cnight_name).toString("hex"),
    );

    const slots = yield* slotConfig;
    const provider = yield* Provider;
    const blaze = yield* provider.blaze;
    const wall = BigInt(yield* Clock.currentTimeMillis) - VALIDITY_MARGIN_MS;
    const validFrom = blaze.provider.unixToSlot(wall);
    const now = BigInt(
      slots.zeroTime + (Number(validFrom) - slots.zeroSlot) * slots.slotLength,
    );
    const nftDatum = nftUtxo.output().datum()?.asInlineData();
    const last = yield* Either.mapLeft(
      nftDatum === undefined
        ? Either.left("the reserve NFT has no inline datum")
        : lastReleaseTime(nftDatum, config.release),
      (reason) =>
        new DatumParseError({
          what: "reserve release state",
          cbor: nftDatum?.toCbor() ?? "",
          reason,
        }),
    );
    const reserveNight = nightIn(reserveUtxos, night);
    const poolNight = nightIn(poolUtxos, night);
    const plan = releasePlan(
      reserveNight,
      poolNight,
      last,
      now,
      config.release,
    );
    if (Option.isNone(plan)) {
      return yield* new PreconditionFailed({
        command: "rewards-release",
        refusal: {
          _tag: "ReleaseNotDue",
          lastReleaseTime: last,
          intervalMs: config.release.intervalMs,
          now,
        },
      });
    }

    yield* out.log(`\nReserve release on ${network}`);
    yield* out.log(
      `Reserve: ${reserveNight} NIGHT in ${reserveUtxos.length} UTxO(s); pool: ${poolNight} in ${poolUtxos.length}`,
    );
    yield* out.log(
      `Release: ${plan.value.intervals} interval(s) from ${last} ms, ${plan.value.released} NIGHT, last release time -> ${plan.value.next} ms`,
    );
    const { coinsPerUtxoByte } = yield* provider.use("getParameters", (p) =>
      p.getParameters(),
    );
    const tx = yield* buildTx(
      buildReleaseTx(
        blaze,
        {
          reserveForever: reserve.forever.Script,
          reserveLogic: reserveScripts.logic,
          reserveMitigation: reserveScripts.mitigationLogic,
          reserveMain,
          nftUtxo,
          reserveUtxos,
          poolForever: pool.forever.Script,
          poolLogic: poolScripts.logic,
          poolMitigation: poolScripts.mitigationLogic,
          poolMain,
          poolUtxos,
          night,
          plan: plan.value,
          validFrom,
        },
        networkId,
        coinsPerUtxoByte,
      ),
      {
        commandName: "rewards-release",
        environment: network,
        witnesses: DEPLOYER_ONLY,
        knownUtxos: [
          nftUtxo,
          ...reserveUtxos,
          ...poolUtxos,
          reserveMain,
          poolMain,
        ],
      },
    );
    return tx;
  });

/** Build the release due now and write it unsigned. */
export const rewardsReleaseProgram = (input: TxFileInput) =>
  Effect.gen(function* () {
    const tx = yield* releaseTx(input.network);
    yield* writeTransaction(
      txFilePath(input),
      tx.toCbor(),
      tx.getId(),
      false,
      "Reserve Release",
    );
    return tx;
  });

/** Whether a failure is the release not being due yet. */
export const releaseNotDue = (error: unknown): boolean =>
  error instanceof PreconditionFailed && error.refusal._tag === "ReleaseNotDue";

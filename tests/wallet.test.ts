/**
 * The wallet commands on one chain state (helpers/wallet-scenario.ts):
 * L2, each plan from its inputs and a frozen context equals the plan the
 * Effect 3 reference makes for the same inputs (tests/golden/wallet/,
 * written by the reference); L3, each command builds its transaction over
 * the emulator, and sign-and-submit gets it accepted by the ledger.
 */
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  AssetId,
  NetworkId,
  SLOT_CONFIG_NETWORK,
  type Transaction,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option, Result } from "effect";
import { HttpClient } from "effect/http";
import * as Contracts from "../contract_blueprint";
import { Provider } from "../cli/chain";
import {
  cnightAssetId,
  DeployedScripts,
  DeployerAddress,
  Profile,
} from "../cli/config";
import { ContractResolver } from "../cli/contracts/resolver";
import { Keys } from "../cli/keys";
import { signAndSubmitProgram } from "../cli/signing";
import type { PlanningContext } from "../cli/tx";
import {
  mergeUtxosProgram,
  mintTcnightProgram,
  planMerge,
  planMintTcnight,
  planSimpleTx,
  simpleTxProgram,
} from "../cli/wallet";
import type { TxHash, TxIndex } from "../cli/input";
import { captureOutput } from "./helpers/output";
import {
  DEPLOYER_KEY,
  planJson,
  USER_KEY,
  walletScenario,
} from "./helpers/wallet-scenario";

const tmp = mkdtempSync(join(tmpdir(), "wallet-"));

/** The emulator's contracts (the default build) and cNIGHT asset, and the scenario over them. */
const setup = Effect.gen(function* () {
  const resolver = Layer.provide(
    Layer.merge(ContractResolver.layer("emulator"), Profile.layer("emulator")),
    Layer.merge(NodeServices.layer, DeployedScripts.layer),
  );
  const { instances, config } = yield* Effect.provide(
    Effect.gen(function* () {
      return {
        instances: yield* (yield* ContractResolver).contracts("actsOn")
          .instances,
        config: yield* (yield* Profile).config,
      };
    }),
    resolver,
  );
  const tcnight = instances.tcnightMintInfinite!.Script;
  const cnight = cnightAssetId(config);
  const scenario = walletScenario({
    tcnight,
    reserveForever: instances.reserveForever.Script,
    reserveTwoStage: instances.reserveTwoStage.Script,
    reserveLogic: instances.reserveLogic.Script,
    govAuth: instances.govAuth.Script,
    upgradeState: (logic, auth) =>
      serialize(Contracts.UpgradeState, [logic, "", auth, "", 0n, 0n]),
    cnight,
  });
  const emulator = new Emulator([]);
  for (const utxo of Object.values(scenario.utxos)) emulator.addUtxo(utxo);
  emulator.accounts.set(scenario.logicAccount, { balance: 0n });
  const output = captureOutput();
  const layer = Layer.mergeAll(
    Layer.provide(
      Provider.over(new EmulatorProvider(emulator)),
      Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make(() => Effect.die("no HTTP in this test")),
      ),
    ),
    resolver,
    DeployerAddress.layer("emulator"),
    Keys.layer,
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        DEPLOYER_ADDRESS: scenario.deployer.toBech32(),
        SIGNING_PRIVATE_KEY: DEPLOYER_KEY,
        USER_PRIVATE_KEY: USER_KEY,
      }),
    ),
    NodeServices.layer,
    DeployedScripts.layer,
    output.layer,
  );
  return {
    scenario,
    tcnight,
    reserveForever: instances.reserveForever.Script,
    reserveLogic: instances.reserveLogic.Script,
    cnight: AssetId(cnight),
    parameters: emulator.params,
    layer,
    output,
  };
});

/** A frozen context over the scenario: nothing in it reads the chain. */
const frozen = <Resolved>(
  base: Effect.Success<typeof setup>,
  resolved: Resolved,
): PlanningContext<Resolved> => ({
  command: "test",
  networkId: NetworkId.Testnet,
  slotConfig: SLOT_CONFIG_NETWORK.Preview,
  parameters: base.parameters,
  wallet: { address: base.scenario.deployer, utxos: [] },
  reserved: new Set(),
  contracts: [],
  resolved,
});

const golden = (name: string) =>
  readFileSync(`tests/golden/wallet/${name}-plan.json`, "utf-8").trimEnd();

describe("plans equal the reference's for the same inputs (L2)", () => {
  it.live("simple-tx", () =>
    Effect.gen(function* () {
      const base = yield* setup;
      const plan = planSimpleTx(
        frozen(base, {
          recipient: base.scenario.user,
          count: 3,
          amount: 5_000_000n,
        }),
      );
      expect(planJson(plan)).toBe(golden("simple"));
      expect(plan).toMatchObject({ feePadding: 0n, expectedWitnesses: 1 });
      expect(Option.isNone(plan.metadata)).toBe(true);
    }),
  );

  it.live("mint-tcnight, a mint", () =>
    Effect.gen(function* () {
      const base = yield* setup;
      const plan = planMintTcnight(
        frozen(base, {
          policy: base.tcnight,
          amount: 100n,
          action: { kind: "mint", destination: base.scenario.user },
        }),
      );
      expect(planJson(plan)).toBe(golden("mint"));
    }),
  );

  it.live("mint-tcnight, a burn with a remainder", () =>
    Effect.gen(function* () {
      const base = yield* setup;
      const plan = planMintTcnight(
        frozen(base, {
          policy: base.tcnight,
          amount: 4n,
          action: {
            kind: "burn",
            spend: [base.scenario.utxos.userNight],
            remainder: 6n,
            user: base.scenario.user,
          },
        }),
      );
      expect(planJson(plan)).toBe(golden("burn"));
    }),
  );

  it.live("merge-utxos", () =>
    Effect.gen(function* () {
      const base = yield* setup;
      const { utxos } = base.scenario;
      const plan = Result.getOrThrow(
        planMerge(
          frozen(base, {
            forever: base.reserveForever,
            utxo1: utxos.merge1,
            utxo2: utxos.merge2,
            twoStageMainUtxo: utxos.reserveMain,
            feeUtxo: utxos.fee,
            logicScript: base.reserveLogic,
            logicRound: 0,
            cnight: base.cnight,
            feePadding: 50_000n,
          }),
        ),
      );
      expect(planJson(plan)).toBe(golden("merge"));
      expect(plan).toMatchObject({ feePadding: 50_000n, expectedWitnesses: 1 });
      expect(Option.getOrUndefined(plan.metadata)).toBe("merge-utxos");
    }),
  );

  it.live(
    "merge-utxos refuses two UTxOs without cNIGHT and a first UTxO without a datum",
    () =>
      Effect.gen(function* () {
        const base = yield* setup;
        const { utxos } = base.scenario;
        const merge = {
          forever: base.reserveForever,
          utxo1: utxos.user,
          utxo2: utxos.deployerFunds,
          twoStageMainUtxo: utxos.reserveMain,
          feeUtxo: utxos.fee,
          logicScript: base.reserveLogic,
          logicRound: 0,
          cnight: base.cnight,
          feePadding: 0n,
        };
        expect(planMerge(frozen(base, merge))).toMatchObject(
          Result.fail({
            _tag: "PreconditionFailed",
            refusal: { _tag: "NoCnight" },
          }),
        );
        expect(
          planMerge(frozen(base, { ...merge, utxo2: utxos.merge2 })),
        ).toMatchObject(Result.fail({ _tag: "DatumParseError" }));
      }),
  );
});

describe("each command's transaction is accepted by the emulator ledger (L3)", () => {
  /** Run the command, then sign-and-submit its file with the key in `signingKey`; the transaction and whether it is on chain. */
  const accepted = (
    file: string,
    command: (
      base: Effect.Success<typeof setup>,
    ) => Effect.Effect<Transaction, unknown, never>,
    signingKey = "SIGNING_PRIVATE_KEY",
  ) =>
    Effect.gen(function* () {
      const base = yield* setup;
      const tx = yield* command(base);
      yield* Effect.provide(
        signAndSubmitProgram({
          signingKey,
          signDeployer: true,
          jsonFile: join(tmp, "emulator", file),
        }),
        base.layer,
      );
      return { tx, lines: base.output.lines };
    });

  const common = { network: "emulator" as const, outputDir: tmp };

  it.live("simple-tx pays the recipient three times", () =>
    Effect.gen(function* () {
      const { tx, lines } = yield* accepted("simple.json", (base) =>
        Effect.provide(
          simpleTxProgram({
            ...common,
            outputFile: "simple.json",
            count: Option.some(3),
            amount: Option.some(5_000_000n),
            to: Option.some(base.scenario.user),
          }),
          base.layer,
        ),
      );
      expect(lines).toContain(`Confirmed: Simple Transaction - ${tx.getId()}`);
      expect(
        tx
          .body()
          .outputs()
          .slice(0, 3)
          .map((o) => o.amount().coin()),
      ).toEqual([5_000_000n, 5_000_000n, 5_000_000n]);
    }),
  );

  it.live("mint-tcnight mints NIGHT from the user's wallet", () =>
    Effect.gen(function* () {
      const { tx, lines } = yield* accepted(
        "mint.json",
        (base) =>
          Effect.provide(
            mintTcnightProgram({
              ...common,
              outputFile: "mint.json",
              amount: 100n,
              userAddress: base.scenario.user,
              burn: false,
              destination: Option.none(),
            }),
            base.layer,
          ),
        "USER_PRIVATE_KEY",
      );
      expect(lines).toContain(
        `Confirmed: Minting TCNight Transaction - ${tx.getId()}`,
      );
    }),
  );

  it.live("mint-tcnight burns NIGHT and returns the remainder", () =>
    Effect.gen(function* () {
      const { tx, lines } = yield* accepted(
        "burn.json",
        (base) =>
          Effect.provide(
            mintTcnightProgram({
              ...common,
              outputFile: "burn.json",
              amount: 4n,
              userAddress: base.scenario.user,
              burn: true,
              destination: Option.none(),
            }),
            base.layer,
          ),
        "USER_PRIVATE_KEY",
      );
      expect(lines).toContain(
        `Confirmed: Burning TCNight Transaction - ${tx.getId()}`,
      );
      expect(lines).toContain("Found 10 TCnight tokens across 1 UTxOs");
    }),
  );

  it.live(
    "merge-utxos merges the two reserve UTxOs under the reserve logic",
    () =>
      Effect.gen(function* () {
        const { tx, lines } = yield* accepted("merge.json", (base) =>
          Effect.provide(
            mergeUtxosProgram({
              ...common,
              outputFile: "merge.json",
              validator: "reserve",
              utxo1Hash: "c1".repeat(32) as TxHash,
              utxo1Index: 0 as TxIndex,
              utxo2Hash: "c2".repeat(32) as TxHash,
              utxo2Index: 1 as TxIndex,
              txHash: "f0".repeat(32) as TxHash,
              txIndex: 0 as TxIndex,
              feePadding: 50_000n,
            }),
            base.layer,
          ),
        );
        expect(lines).toContain(
          `Confirmed: Merge UTxOs Transaction - ${tx.getId()}`,
        );
        expect(lines).toContain("Local UPLC test passed");
      }),
  );

  it.live(
    "mint-tcnight refuses --burn with --destination before any read",
    () =>
      Effect.gen(function* () {
        const base = yield* setup;
        const error = yield* Effect.flip(
          Effect.provide(
            mintTcnightProgram({
              ...common,
              outputFile: "x.json",
              amount: 1n,
              userAddress: base.scenario.user,
              burn: true,
              destination: Option.some(base.scenario.user),
            }),
            base.layer,
          ),
        );
        expect(error).toMatchObject({
          _tag: "InputParseError",
          source: "--destination",
        });
      }),
  );
});

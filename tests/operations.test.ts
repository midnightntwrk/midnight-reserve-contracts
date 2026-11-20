/**
 * migrate-federated-ops, mint-staging-state, register-gov-auth,
 * register-cnight-mint-logic and run-cnight-mint-mainnet on one chain
 * state (helpers/operations-scenario.ts): L2, each plan from its inputs and
 * a frozen context equals the plan the Effect 3 reference makes for the
 * same inputs (tests/golden/operations/, written by the reference); L3,
 * each command builds its transaction over the emulator and
 * sign-and-submit gets it accepted by the ledger. The validators refuse
 * the v1 federated-ops logic's migration and a cNIGHT run whose logic
 * fails; the registration checks refuse what the chain reports.
 */
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  addressFromValidator,
  AssetId,
  NetworkId,
  type RewardAccount,
  type Script,
  SLOT_CONFIG_NETWORK,
  type Transaction,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { HttpClient } from "effect/http";
import * as Contracts from "../contract_blueprint";
import { ensureRegistered, Provider, refuseRegistered } from "../cli/chain";
import { DeployedScripts, DeployerAddress, Profile } from "../cli/config";
import { ContractResolver } from "../cli/contracts/resolver";
import {
  planRegisterCnightMintLogic,
  planRunCnightMint,
  registerCnightMintLogicProgram,
  runCnightMintProgram,
} from "../cli/governance/cnight";
import {
  migrateFederatedOpsProgram,
  mintStagingStateProgram,
  planFederatedOpsMigration,
  planMintStagingState,
} from "../cli/governance/staging";
import {
  planRegisterGovAuth,
  registerGovAuthProgram,
} from "../cli/governance/two-stage";
import { PreconditionFailed, StakeNotRegistered } from "../cli/errors";
import type { TxHash, TxIndex } from "../cli/input";
import { Keys } from "../cli/keys";
import { signAndSubmitProgram } from "../cli/signing";
import {
  compile,
  createRewardAccount,
  type PlanningContext,
  type TxPlan,
} from "../cli/tx";
import { operationsScenario } from "./helpers/operations-scenario";
import { captureOutput } from "./helpers/output";
import { planJson } from "./helpers/wallet-scenario";

const tmp = mkdtempSync(join(tmpdir(), "operations-"));

/** What a test seeds: the reward accounts registered on the ledger, and the logics the federated-ops and cNIGHT mint main states name (by default the v2 federated-ops logic and the cNIGHT mint logic). */
interface Seed {
  readonly registered?: (
    accounts: Scenario["rewardAccounts"],
  ) => readonly RewardAccount[];
  readonly named?: (scripts: Scripts) => {
    readonly federatedOps?: Script;
    readonly cnightMint?: Script;
  };
}

/** The emulator's contracts (the default build) and profile, the scenario over them as `seed` asks, and every service a command needs. */
const setup = ({ registered = () => [], named = () => ({}) }: Seed = {}) =>
  Effect.gen(function* () {
    const resolver = Layer.provide(
      Layer.merge(
        ContractResolver.layer("emulator"),
        Profile.layer("emulator"),
      ),
      Layer.merge(NodeServices.layer, DeployedScripts.layer),
    );
    const { i, config } = yield* Effect.provide(
      Effect.gen(function* () {
        return {
          i: yield* (yield* ContractResolver).contracts("creates").instances,
          config: yield* (yield* Profile).config,
        };
      }),
      resolver,
    );
    const scripts = {
      govAuth: i.govAuth.Script,
      stagingGovAuth: i.stagingGovAuth.Script,
      federatedOpsForever: i.federatedOpsForever.Script,
      federatedOpsTwoStage: i.federatedOpsTwoStage.Script,
      federatedOpsLogic: i.federatedOpsLogic.Script,
      federatedOpsLogicV2: new Contracts.PermissionedV2FederatedOpsLogicV2Else()
        .Script,
      cnightMintForever: i.cnightMintForever!.Script,
      cnightMintTwoStage: i.cnightMintTwoStage!.Script,
      cnightMintLogic: i.cnightMintLogic!.Script,
      cnightMintLogicV2: new Contracts.CnightMintingV2CnightMintLogicV2Else()
        .Script,
      councilLogicV2: new Contracts.PermissionedV2CouncilLogicV2Else().Script,
      councilStagingForever: i.councilStagingForever!.Script,
    };
    const logics = {
      federatedOps: scripts.federatedOpsLogicV2,
      cnightMint: scripts.cnightMintLogic,
      ...named(scripts),
    };
    const scenario = operationsScenario(
      {
        ...scripts,
        federatedOpsLogic: logics.federatedOps,
        cnightMintLogic: logics.cnightMint,
      },
      {
        councilV2OneShot: [
          config.council_logic_v2_one_shot_hash,
          config.council_logic_v2_one_shot_index,
        ],
        collateral: [config.collateral_utxo_hash, config.collateral_utxo_index],
      },
    );
    const emulator = new Emulator([]);
    for (const utxo of Object.values(scenario.utxos)) emulator.addUtxo(utxo);
    for (const account of registered(scenario.rewardAccounts)) {
      emulator.accounts.set(account, { balance: 0n });
    }
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
      ConfigProvider.layer(ConfigProvider.fromUnknown(scenario.env)),
      NodeServices.layer,
      DeployedScripts.layer,
      output.layer,
    );
    return { scenario, scripts, logics, config, emulator, layer, output };
  });

type Scenario = ReturnType<typeof operationsScenario>;
type Scripts = {
  readonly [
    K in
      | "federatedOpsLogic"
      | "federatedOpsLogicV2"
      | "cnightMintLogic"
      | "cnightMintLogicV2"
  ]: Script;
};
type Base = Effect.Success<ReturnType<typeof setup>>;

/** A frozen context over the scenario: nothing in it reads the chain. */
const frozen = <Resolved>(
  base: Base,
  command: string,
  resolved: Resolved,
): PlanningContext<Resolved> => ({
  command,
  networkId: NetworkId.Testnet,
  slotConfig: SLOT_CONFIG_NETWORK.Preview,
  parameters: base.emulator.params,
  wallet: {
    address: base.scenario.deployer,
    utxos: [base.scenario.utxos.deployerFunds],
  },
  reserved: new Set(),
  contracts: [],
  resolved,
});

const golden = (name: string) =>
  readFileSync(`tests/golden/operations/${name}-plan.json`, "utf-8").trimEnd();

/** The migration over the scenario, through the logic its main state names. */
const migration = (base: Base) => ({
  forever: base.scripts.federatedOpsForever,
  foreverUtxo: base.scenario.utxos.federatedOpsForever,
  twoStageUtxo: base.scenario.utxos.federatedOpsMain,
  feeUtxo: base.scenario.utxos.fee,
  current: base.scenario.federatedOpsV1,
  logicScript: base.logics.federatedOps,
  mitigationLogicScript: Option.none(),
  feePadding: 50_000n,
});

/** The cNIGHT run over the scenario, through the logic its main state names. */
const cnightRun = (base: Base) => ({
  forever: base.scripts.cnightMintForever,
  twoStageMainUtxo: base.scenario.utxos.cnightMintMain,
  feeUtxo: base.scenario.utxos.fee,
  logicScript: base.logics.cnightMint,
  mitigationLogicScript: Option.none(),
  feePadding: 50_000n,
});

describe("plans equal the reference's for the same inputs (L2)", () => {
  it.live("migrate-federated-ops", () =>
    Effect.gen(function* () {
      const base = yield* setup();
      const plan = planFederatedOpsMigration(
        frozen(base, "migrate-federated-ops", migration(base)),
      );
      expect(planJson(plan)).toBe(golden("migrate-federated-ops"));
      expect(plan.outputs[0].datum()?.asInlineData()?.toCbor()).toBe(
        serialize(Contracts.FederatedOpsV2, [
          base.scenario.federatedOpsV1[0],
          "",
          base.scenario.federatedOpsV1[1],
          2n,
        ]).toCbor(),
      );
    }),
  );

  it.live("mint-staging-state", () =>
    Effect.gen(function* () {
      const base = yield* setup();
      const plan = planMintStagingState(
        frozen(base, "mint-staging-state", {
          oneShotUtxo: base.scenario.utxos.councilV2OneShot,
          v2LogicScript: base.scripts.councilLogicV2,
          stagingForeverHash: base.scripts.councilStagingForever.hash(),
          cnightPolicy: base.config.cnight_policy,
          collateralUtxo: base.scenario.utxos.collateral,
          feePadding: 50_000n,
          expectedWitnesses: 1,
        }),
      );
      expect(planJson(plan)).toBe(golden("mint-staging-state"));
    }),
  );

  it.live("register-gov-auth", () =>
    Effect.gen(function* () {
      const base = yield* setup();
      const plan = planRegisterGovAuth(
        frozen(base, "register-gov-auth", {
          govAuth: base.scripts.govAuth,
          stagingGovAuth: base.scripts.stagingGovAuth,
        }),
      );
      expect(planJson(plan)).toBe(golden("register-gov-auth"));
      expect(Option.isNone(plan.metadata)).toBe(true);
    }),
  );

  it.live("register-cnight-mint-logic", () =>
    Effect.gen(function* () {
      const base = yield* setup();
      const plan = planRegisterCnightMintLogic(
        frozen(base, "register-cnight-mint-logic", {
          feeUtxo: base.scenario.utxos.fee,
          cnightMintLogic: base.scripts.cnightMintLogic,
          feePadding: 50_000n,
        }),
      );
      expect(planJson(plan)).toBe(golden("register-cnight-mint-logic"));
    }),
  );

  it.live("run-cnight-mint-mainnet", () =>
    Effect.gen(function* () {
      const base = yield* setup();
      const plan = planRunCnightMint(
        frozen(base, "run-cnight-mint-mainnet", cnightRun(base)),
      );
      expect(planJson(plan)).toBe(golden("run-cnight-mint-mainnet"));
    }),
  );
});

describe("the validators refuse", () => {
  /** Compile the plan over a scenario whose main state names `logic`; the failure must be that logic's withdrawal, named in the traces. */
  const refusedBy = <Resolved>(
    named: NonNullable<Seed["named"]>,
    logic: (scripts: Scripts) => {
      readonly className: string;
      readonly script: Script;
    },
    command: string,
    resolved: (base: Base) => Resolved,
    plan: (ctx: PlanningContext<Resolved>) => TxPlan,
  ) =>
    Effect.gen(function* () {
      const base = yield* setup({ named });
      const { className, script } = logic(base.scripts);
      const ctx = {
        ...frozen(base, command, resolved(base)),
        contracts: [{ className, hash: script.hash() }],
      };
      const error = yield* Effect.flip(compile(plan(ctx), ctx));
      expect(error._tag).toBe("TxBuildError");
      expect(error.traces).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            new RegExp(`Withdraw\\[\\d+\\] \\(${className}\\)`),
          ),
        ]),
      );
    });

  it.live(
    "the v1 federated-ops logic, named by the main state, has no Migrate branch",
    () =>
      refusedBy(
        (scripts) => ({ federatedOps: scripts.federatedOpsLogic }),
        (scripts) => ({
          className: "PermissionedFederatedOpsLogicElse",
          script: scripts.federatedOpsLogic,
        }),
        "migrate-federated-ops",
        migration,
        planFederatedOpsMigration,
      ),
  );

  it.live("a cNIGHT run whose named logic fails is refused by that logic", () =>
    refusedBy(
      (scripts) => ({ cnightMint: scripts.cnightMintLogicV2 }),
      (scripts) => ({
        className: "CnightMintingV2CnightMintLogicV2Else",
        script: scripts.cnightMintLogicV2,
      }),
      "run-cnight-mint-mainnet",
      cnightRun,
      planRunCnightMint,
    ),
  );
});

describe("each command's transaction is accepted by the emulator ledger (L3)", () => {
  const fee = (outputFile: string) => ({
    network: "emulator" as const,
    outputDir: tmp,
    outputFile,
    txHash: "f0".repeat(32) as TxHash,
    txIndex: 0 as TxIndex,
    feePadding: 50_000n,
  });

  /** Run the command, then sign-and-submit its file with the deployer key; the transaction, the output and the ledger. */
  const accepted = (
    file: string,
    command: (base: Base) => Effect.Effect<Transaction, unknown, never>,
    registered?: Seed["registered"],
  ) =>
    Effect.gen(function* () {
      const base = yield* setup({ registered });
      const tx = yield* command(base);
      yield* Effect.provide(
        signAndSubmitProgram({
          signingKey: "SIGNING_PRIVATE_KEY",
          signDeployer: true,
          jsonFile: join(tmp, "emulator", file),
        }),
        base.layer,
      );
      return { tx, lines: base.output.lines, base };
    });

  it.live("migrate-federated-ops writes the v2 datum", () =>
    Effect.gen(function* () {
      const { tx, lines, base } = yield* accepted(
        "migrate-federated-ops-tx.json",
        (b) =>
          Effect.provide(
            migrateFederatedOpsProgram(fee("migrate-federated-ops-tx.json")),
            b.layer,
          ),
        (accounts) => [accounts.federatedOpsLogic],
      );
      expect(lines).toContain(
        `Confirmed: Migrate Federated Ops Transaction - ${tx.getId()}`,
      );
      const forever = base.emulator
        .utxos()
        .find(
          (utxo) =>
            utxo.output().address().toBech32() ===
            addressFromValidator(
              NetworkId.Testnet,
              base.scripts.federatedOpsForever,
            ).toBech32(),
        );
      expect(
        forever?.output().datum()?.asInlineData()?.asList()?.getLength(),
      ).toBe(4);
    }),
  );

  it.live(
    "mint-staging-state locks the StagingState NFT at the council v2 logic",
    () =>
      Effect.gen(function* () {
        const { tx, lines, base } = yield* accepted(
          "mint-staging-state-tx.json",
          (b) =>
            Effect.provide(
              mintStagingStateProgram({
                network: "emulator",
                outputDir: tmp,
                outputFile: "mint-staging-state-tx.json",
                validator: "council",
                feePadding: 50_000n,
                // The Blaze emulator runs no native script, so it refuses the tech authority's vkeys as extraneous.
                sign: false,
              }),
              b.layer,
            ),
        );
        expect(lines).toContain(
          `Confirmed: Mint StagingState NFT Transaction - ${tx.getId()}`,
        );
        const logic = base.scripts.councilLogicV2;
        expect(
          base.emulator
            .utxos()
            .some(
              (utxo) =>
                utxo.output().address().toBech32() ===
                  addressFromValidator(NetworkId.Testnet, logic).toBech32() &&
                utxo
                  .output()
                  .amount()
                  .multiasset()
                  ?.get(AssetId(logic.hash())) === 1n,
            ),
        ).toBe(true);
      }),
  );

  it.live("register-gov-auth registers both gov-auth credentials", () =>
    Effect.gen(function* () {
      const { tx, lines, base } = yield* accepted(
        "register-gov-auth-tx.json",
        (b) =>
          Effect.provide(
            registerGovAuthProgram({
              network: "emulator",
              outputDir: tmp,
              outputFile: "register-gov-auth-tx.json",
            }),
            b.layer,
          ),
      );
      expect(lines).toContain(
        `Confirmed: Register Government Authority Transaction - ${tx.getId()}`,
      );
      expect(tx.body().certs()?.values()).toHaveLength(2);
      expect(base.emulator.accounts.size).toBe(2);
    }),
  );

  it.live("register-cnight-mint-logic registers the mint logic", () =>
    Effect.gen(function* () {
      const { tx, lines, base } = yield* accepted(
        "register-cnight-mint-logic-tx.json",
        (b) =>
          Effect.provide(
            registerCnightMintLogicProgram(
              fee("register-cnight-mint-logic-tx.json"),
            ),
            b.layer,
          ),
      );
      expect(lines).toContain(
        `Confirmed: Register cNIGHT Mint Logic Transaction - ${tx.getId()}`,
      );
      expect(
        base.emulator.accounts.has(
          base.scenario.rewardAccounts.cnightMintLogic,
        ),
      ).toBe(true);
    }),
  );

  it.live(
    "run-cnight-mint-mainnet withdraws through the forever and the logic",
    () =>
      Effect.gen(function* () {
        const { tx, lines } = yield* accepted(
          "run-cnight-mint-mainnet-tx.json",
          (b) =>
            Effect.provide(
              runCnightMintProgram(fee("run-cnight-mint-mainnet-tx.json")),
              b.layer,
            ),
          (accounts) => [accounts.cnightMintForever, accounts.cnightMintLogic],
        );
        expect(lines).toContain(
          `Confirmed: Run cNIGHT Mint Mainnet Transaction - ${tx.getId()}`,
        );
        expect(tx.body().withdrawals()?.size).toBe(2);
      }),
  );
});

describe("the registration checks read Provider.rewardAccountRegistered", () => {
  /** A Provider that answers only the registration read: Some(registered) for the accounts in `registered`, Some(false) for any other. */
  const answering = (registered: readonly RewardAccount[]) =>
    Layer.succeed(Provider)({
      parameters: Effect.die("not read"),
      unspentOutputs: () => Effect.die("not read"),
      submit: () => Effect.die("not read"),
      isConfirmed: () => Effect.die("not read"),
      rewardAccountRegistered: (account) =>
        Effect.succeed(Option.some(registered.includes(account))),
    });
  const GOV_AUTH = "11".repeat(28);
  const STAGING_GOV_AUTH = "22".repeat(28);
  const accountOf = (hash: string) =>
    createRewardAccount(hash, NetworkId.Testnet);

  it.live("refuseRegistered names the scripts the chain already holds", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.provide(
          refuseRegistered("register-gov-auth", "preview", [
            { label: "Main Gov Auth", scriptHash: GOV_AUTH },
            { label: "Staging Gov Auth", scriptHash: STAGING_GOV_AUTH },
          ]),
          answering([accountOf(STAGING_GOV_AUTH)]),
        ),
      );
      expect(error).toEqual(
        new PreconditionFailed({
          command: "register-gov-auth",
          refusal: {
            _tag: "AlreadyRegistered",
            environment: "preview",
            scripts: [
              { label: "Staging Gov Auth", scriptHash: STAGING_GOV_AUTH },
            ],
          },
        }),
      );
    }),
  );

  it.live(
    "ensureRegistered lists the reward accounts the chain does not hold",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.provide(
            ensureRegistered("preview", [
              { label: "cNIGHT Mint Forever", scriptHash: GOV_AUTH },
              { label: "cNIGHT Mint Logic", scriptHash: STAGING_GOV_AUTH },
            ]),
            answering([accountOf(GOV_AUTH)]),
          ),
        );
        expect(error).toEqual(
          new StakeNotRegistered({
            environment: "preview",
            accounts: [
              {
                label: "cNIGHT Mint Logic",
                scriptHash: STAGING_GOV_AUTH,
                rewardAccount: accountOf(STAGING_GOV_AUTH),
              },
            ],
          }),
        );
      }),
  );
});

/**
 * stage-upgrade and promote-upgrade.
 * - L2: on one chain state (helpers/upgrade-scenario.ts), each plan from its
 *   inputs and a frozen context equals the reference's
 *   (tests/golden/upgrade/, written by the reference).
 * - L3: each command builds over the emulator and sign-and-submit gets it
 *   accepted; the reserve's staging and main states then hold what was
 *   staged and promoted.
 * - The mainnet upgrade transactions: the plans against the mainnet
 *   snapshot UTxOs, validated by the deployed scripts.
 * - Row 17: on preprod, stage-upgrade takes the forevers, the threshold and
 *   gov auth from the record (every hash differs from the preprod build's),
 *   copies a build-only logic into the record and tracks it as staged.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  addressFromCredential,
  AssetId,
  CborSet,
  Credential,
  CredentialType,
  Ed25519PrivateNormalKeyHex,
  Hash28ByteBase16,
  NetworkId,
  PaymentAddress,
  RewardAccount,
  type Script,
  SLOT_CONFIG_NETWORK,
  TransactionId,
  TransactionUnspentOutput,
  VkeyWitness,
  blake2b_224,
  derivePublicKey,
  HexBlob,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  Array as Arr,
  ConfigProvider,
  Effect,
  Layer,
  Option,
  Result,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Contracts from "../contract_blueprint";
import * as Mainnet from "../deployed-scripts/mainnet/contract_blueprint";
import { Provider } from "../cli/chain";
import {
  DeployedScripts,
  DeployerAddress,
  type Environment,
  Profile,
} from "../cli/config";
import { ContractResolver } from "../cli/contracts/resolver";
import { decodeSigners } from "../cli/datum";
import {
  authorityThreshold,
  type GovernanceAuthority,
  witnessRequirements,
} from "../cli/governance/multisig";
import {
  MAIN_TOKEN_HEX,
  nextStagingState,
  planPromote,
  planStage,
  promotedMainState,
  promoteUpgradeProgram,
  STAGING_TOKEN_HEX,
  stageUpgradeProgram,
  type TwoStageTarget,
  type Upgrade,
  type UpgradeField,
} from "../cli/governance/two-stage";
import {
  parseScriptHash,
  type ScriptHash,
  type Signer,
  type TxHash,
  type TxIndex,
} from "../cli/input";
import { Keys } from "../cli/keys";
import { signAndSubmitProgram, signTransaction } from "../cli/signing";
import { compile, type PlanningContext } from "../cli/tx";
import { mainnetSnapshotUtxos as snap } from "./helpers/mainnet-snapshot";
import { captureOutput } from "./helpers/output";
import {
  type UpgradeScripts,
  upgradeScenario,
} from "./helpers/upgrade-scenario";
import { DEPLOYER_KEY, planJson } from "./helpers/wallet-scenario";

const tmp = mkdtempSync(join(tmpdir(), "upgrade-"));

const nonEmpty = (signers: readonly Signer[]) =>
  signers as Arr.NonEmptyReadonlyArray<Signer>;

const THRESHOLD = Result.getOrThrow(authorityThreshold([2n, 3n, 2n, 3n]));

/** A Blockfrost that reports every reward account registered, for the checks of a public environment. */
const registeredEverywhere = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify({ registered: true }), { status: 200 }),
      ),
    ),
  ),
);

/** The scenario over `environment`'s acting-on contracts (the build on the emulator, the record on preprod), and every service a command needs; `root` is the record root. */
const setup = (environment: Environment, root?: string) =>
  Effect.gen(function* () {
    const deployedScripts =
      root === undefined ? DeployedScripts.layer : DeployedScripts.at(root);
    const resolver = Layer.provide(
      Layer.merge(
        ContractResolver.layer(environment),
        Profile.layer(environment),
      ),
      Layer.merge(NodeServices.layer, deployedScripts),
    );
    const i = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* (yield* ContractResolver).contracts("actsOn").instances;
      }),
      resolver,
    );
    const scripts: UpgradeScripts = {
      govAuth: i.govAuth.Script,
      stagingGovAuth: i.stagingGovAuth.Script,
      techAuthForever: i.techAuthForever.Script,
      councilForever: i.councilForever.Script,
      councilTwoStage: i.councilTwoStage.Script,
      councilLogic: i.councilLogic.Script,
      mainGovThreshold: i.mainGovThreshold.Script,
      stagingGovThreshold: i.stagingGovThreshold.Script,
      reserveTwoStage: i.reserveTwoStage.Script,
      reserveLogic: i.reserveLogic.Script,
      stagedLogic: new Contracts.ReserveV2ReserveLogicV2Else().Script,
    };
    const scenario = upgradeScenario(scripts);
    const emulator = new Emulator([]);
    for (const utxo of Object.values(scenario.utxos)) emulator.addUtxo(utxo);
    for (const account of scenario.rewardAccounts) {
      emulator.accounts.set(account, { balance: 0n });
    }
    const output = captureOutput();
    const layer = Layer.mergeAll(
      Layer.provide(
        Provider.over(new EmulatorProvider(emulator), environment),
        registeredEverywhere,
      ),
      resolver,
      DeployerAddress.layer(environment),
      Keys.layer,
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ...scenario.env,
          BLOCKFROST_PREPROD_API_KEY: "preprod0000000000000000000000000000",
        }),
      ),
      NodeServices.layer,
      deployedScripts,
      output.layer,
    );
    return { scenario, scripts, emulator, layer, output };
  });

type Base = Effect.Success<ReturnType<typeof setup>>;

/** The reserve as a target, its states as the scenario seeds them. */
const reserveTarget = (base: Base): TwoStageTarget => ({
  twoStage: base.scripts.reserveTwoStage,
  mainUtxo: base.scenario.utxos.reserveMain,
  stagingUtxo: base.scenario.utxos.reserveStaging,
  mainState: base.scenario.reserveMainState,
  stagingState: base.scenario.reserveStagingState,
});

/** The scenario's main or staging authority. */
const authorityOf = (
  base: Base,
  scope: "Main" | "Staging",
): GovernanceAuthority => {
  const techAuthSigners = nonEmpty(base.scenario.techAuth);
  const councilSigners = nonEmpty(base.scenario.council);
  const { utxos } = base.scenario;
  return {
    govAuth:
      scope === "Main" ? base.scripts.govAuth : base.scripts.stagingGovAuth,
    thresholdUtxo:
      scope === "Main" ? utxos.mainGovThreshold : utxos.stagingGovThreshold,
    techAuthForeverUtxo: utxos.techAuthForever,
    councilForeverUtxo: utxos.councilForever,
    techAuthSigners,
    councilSigners,
    requirements: witnessRequirements(THRESHOLD, {
      techAuthSigners,
      councilSigners,
    }),
    councilMainUtxo:
      scope === "Main" ? Option.none() : Option.some(utxos.councilMain),
  };
};

/** A frozen context: nothing in it reads the chain. */
const frozen = <Resolved>(
  command: string,
  networkId: NetworkId,
  parameters: Emulator["params"],
  wallet: PlanningContext["wallet"],
  resolved: Resolved,
): PlanningContext<Resolved> => ({
  command,
  networkId,
  slotConfig:
    networkId === NetworkId.Mainnet
      ? SLOT_CONFIG_NETWORK.Mainnet
      : SLOT_CONFIG_NETWORK.Preview,
  parameters,
  wallet,
  reserved: new Set(),
  contracts: [],
  resolved,
});

/** The new logic stage-upgrade stages on the emulator: the default build's reserve v2 logic. */
const NEW_LOGIC = Result.getOrThrow(
  parseScriptHash(new Contracts.ReserveV2ReserveLogicV2Else().Script.hash()),
);

const golden = (name: string) =>
  readFileSync(`tests/golden/upgrade/${name}-plan.json`, "utf-8").trimEnd();

const emulatorUpgrade = (base: Base, scope: "Main" | "Staging"): Upgrade => ({
  target: reserveTarget(base),
  authority: authorityOf(base, scope),
  feeUtxo: base.scenario.utxos.fee,
  field: "Logic",
  feePadding: 50_000n,
  expectedWitnesses: 7,
});

const emulatorWallet = (base: Base) => ({
  address: base.scenario.deployer,
  utxos: [base.scenario.utxos.deployerFunds],
});

describe("plans equal the reference's for the same inputs (L2)", () => {
  it.live("stage-upgrade", () =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const plan = planStage(
        frozen(
          "stage-upgrade",
          NetworkId.Testnet,
          base.emulator.params,
          emulatorWallet(base),
          { ...emulatorUpgrade(base, "Staging"), newHash: NEW_LOGIC },
        ),
      );
      expect(planJson(plan)).toBe(golden("stage-upgrade"));
      expect(plan).toMatchObject({ feePadding: 50_000n, expectedWitnesses: 7 });
    }),
  );

  it.live("promote-upgrade", () =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const plan = planPromote(
        frozen(
          "promote-upgrade",
          NetworkId.Testnet,
          base.emulator.params,
          emulatorWallet(base),
          { ...emulatorUpgrade(base, "Main"), registerLogic: Option.none() },
        ),
      );
      expect(planJson(plan)).toBe(golden("promote-upgrade"));
    }),
  );
});

describe("UpgradeState transitions", () => {
  const state: Contracts.UpgradeState = ["l0", "m0", "a0", "n0", 3n, 7n];
  const staging: Contracts.UpgradeState = ["l1", "m1", "a1", "n1", 9n, 8n];

  it.each([
    [
      "Logic",
      "l1",
      ["l1", "m0", "a0", "n0", 3n, 8n],
      ["l1", "m0", "a0", "n0", 3n, 8n],
    ],
    [
      "Auth",
      "a1",
      ["l0", "m0", "a1", "n0", 4n, 7n],
      ["l0", "m0", "a1", "n0", 9n, 7n],
    ],
    [
      "MitigationLogic",
      "m1",
      ["l0", "m1", "a0", "n0", 4n, 7n],
      ["l0", "m1", "a0", "n0", 9n, 7n],
    ],
    [
      "MitigationAuth",
      "n1",
      ["l0", "m0", "a0", "n1", 4n, 7n],
      ["l0", "m0", "a0", "n1", 9n, 7n],
    ],
  ] satisfies [
    UpgradeField,
    string,
    Contracts.UpgradeState,
    Contracts.UpgradeState,
  ][])(
    "%s: staging bumps its round; promotion copies the field and its round",
    (field, hash, staged, promoted) => {
      expect(nextStagingState(field, state, hash)).toEqual(staged);
      expect(promotedMainState(field, state, staging)).toEqual(promoted);
    },
  );
});

/** The UpgradeState of the ledger UTxO holding this two-stage token. */
const stateHolding = (emulator: Emulator, twoStage: Script, tokenHex: string) =>
  parse(
    Contracts.UpgradeState,
    emulator
      .utxos()
      .find(
        (utxo) =>
          utxo
            .output()
            .amount()
            .multiasset()
            ?.get(AssetId(twoStage.hash() + tokenHex)) === 1n,
      )!
      .output()
      .datum()!
      .asInlineData()!,
  );

describe("each command's transaction is accepted by the emulator ledger (L3)", () => {
  const input = (outputFile: string) => ({
    network: "emulator" as const,
    outputDir: tmp,
    outputFile,
    validator: "reserve" as const,
    txHash: "f0".repeat(32) as TxHash,
    txIndex: 0 as TxIndex,
    feePadding: 50_000n,
    // The Blaze emulator runs no native script, so it refuses the authorities' vkeys as extraneous.
    sign: false,
  });

  const submitted = (base: Base, file: string) =>
    Effect.provide(
      signAndSubmitProgram({
        signingKey: "SIGNING_PRIVATE_KEY",
        signDeployer: true,
        jsonFile: join(tmp, "emulator", file),
      }),
      base.layer,
    );

  it.live("stage-upgrade stages the new logic, raising logic_round", () =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const tx = yield* Effect.provide(
        stageUpgradeProgram({
          ...input("stage-upgrade-tx.json"),
          newLogicHash: NEW_LOGIC,
        }),
        base.layer,
      );
      yield* submitted(base, "stage-upgrade-tx.json");
      expect(base.output.lines).toContain(
        `Confirmed: Stage Upgrade Transaction - ${tx.getId()}`,
      );
      expect(
        stateHolding(
          base.emulator,
          base.scripts.reserveTwoStage,
          STAGING_TOKEN_HEX,
        ),
      ).toEqual(
        nextStagingState("Logic", base.scenario.reserveStagingState, NEW_LOGIC),
      );
    }),
  );

  it.live("promote-upgrade moves the staged logic and its round to main", () =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const tx = yield* Effect.provide(
        promoteUpgradeProgram({
          ...input("promote-upgrade-tx.json"),
          useBuild: false,
        }),
        base.layer,
      );
      yield* submitted(base, "promote-upgrade-tx.json");
      expect(base.output.lines).toContain(
        `Confirmed: Promote Upgrade Transaction - ${tx.getId()}`,
      );
      expect(
        stateHolding(
          base.emulator,
          base.scripts.reserveTwoStage,
          MAIN_TOKEN_HEX,
        ),
      ).toEqual(
        promotedMainState(
          "Logic",
          base.scenario.reserveMainState,
          base.scenario.reserveStagingState,
        ),
      );
    }),
  );

  it.live(
    "a logic hash in neither the record nor the build is refused before any chain read",
    () =>
      Effect.gen(function* () {
        const base = yield* setup("emulator");
        const error = yield* Effect.flip(
          Effect.provide(
            stageUpgradeProgram({
              ...input("x.json"),
              newLogicHash: "ab".repeat(28) as ScriptHash,
            }),
            base.layer,
          ),
        );
        expect(error).toMatchObject({
          _tag: "PreconditionFailed",
          refusal: { _tag: "LogicNotFound", logicHash: "ab".repeat(28) },
        });
      }),
  );
});

describe("Mainnet snapshot upgrade transactions", () => {
  const govAuth = new Mainnet.GovAuthMainGovAuthElse().Script;
  const stagingGovAuth = new Mainnet.GovAuthStagingGovAuthElse().Script;
  const reserveTwoStage = new Mainnet.ReserveReserveTwoStageUpgradeElse()
    .Script;
  const councilTwoStage = new Mainnet.PermissionedCouncilTwoStageUpgradeElse()
    .Script;
  const techAuthTwoStage = new Mainnet.PermissionedTechAuthTwoStageUpgradeElse()
    .Script;

  const stateOf = (utxo: TransactionUnspentOutput) =>
    parse(Mainnet.UpgradeState, utxo.output().datum()!.asInlineData()!);
  const thresholdOf = (utxo: TransactionUnspentOutput) =>
    Result.getOrThrow(
      authorityThreshold(
        parse(
          Mainnet.MultisigThreshold,
          utxo.output().datum()!.asInlineData()!,
        ),
      ),
    );

  const deployerKey = Ed25519PrivateNormalKeyHex(DEPLOYER_KEY);
  const deployer = addressFromCredential(
    NetworkId.Mainnet,
    Credential.fromCore({
      type: CredentialType.KeyHash,
      hash: Hash28ByteBase16(
        blake2b_224(HexBlob(derivePublicKey(deployerKey))),
      ),
    }),
  );
  const funds = (txByte: string) =>
    TransactionUnspentOutput.fromCore([
      { txId: TransactionId(txByte.repeat(32)), index: 0 },
      {
        address: PaymentAddress(deployer.toBech32()),
        value: { coins: 1_000_000_000n },
      },
    ]);
  const feeUtxo = funds("fe");
  const walletUtxo = funds("fd");

  const authority = (
    scope: "Main" | "Staging",
    councilSigners?: readonly Signer[],
  ) =>
    Effect.gen(function* () {
      const techAuthSigners = yield* decodeSigners(
        snap.techAuthForever.output().datum()!.asInlineData()!,
      );
      const council = nonEmpty(
        councilSigners ??
          (yield* decodeSigners(
            snap.councilForever.output().datum()!.asInlineData()!,
          )),
      );
      const thresholdUtxo =
        scope === "Main" ? snap.mainGovThreshold : snap.stagingGovThreshold;
      const result: GovernanceAuthority = {
        govAuth: scope === "Main" ? govAuth : stagingGovAuth,
        thresholdUtxo,
        techAuthForeverUtxo: snap.techAuthForever,
        councilForeverUtxo: snap.councilForever,
        techAuthSigners,
        councilSigners: council,
        requirements: witnessRequirements(thresholdOf(thresholdUtxo), {
          techAuthSigners,
          councilSigners: council,
        }),
        councilMainUtxo:
          scope === "Main" ? Option.none() : Option.some(snap.councilMain),
      };
      return result;
    });

  const target = (
    twoStage: Script,
    mainUtxo: TransactionUnspentOutput,
    stagingUtxo: TransactionUnspentOutput,
  ): TwoStageTarget => ({
    twoStage,
    mainUtxo,
    stagingUtxo,
    mainState: stateOf(mainUtxo),
    stagingState: stateOf(stagingUtxo),
  });
  const reserve = () =>
    target(reserveTwoStage, snap.reserveMain, snap.reserveStaging);

  /** The snapshot UTxO with another UpgradeState under a fresh tx id. */
  const withState = (
    utxo: TransactionUnspentOutput,
    state: Mainnet.UpgradeState,
    txByte: string,
  ) => {
    const output = utxo.output();
    return TransactionUnspentOutput.fromCore([
      { txId: TransactionId(txByte.repeat(32)), index: 0 },
      {
        address: PaymentAddress(output.address().toBech32()),
        value: {
          coins: output.amount().coin(),
          assets: new Map(output.amount().multiasset()),
        },
        datum: serialize(Mainnet.UpgradeState, state).toCore(),
      },
    ]);
  };

  /** Compile the plan over a fresh emulator holding its UTxOs, sign it with the deployer key and submit it; the ledger afterwards. */
  const onLedger = (
    upgrade: Upgrade,
    plan: (
      ctx: PlanningContext<
        Upgrade & {
          readonly newHash: string;
          readonly registerLogic: Option.Option<Script>;
        }
      >,
    ) => ReturnType<typeof planStage>,
    newHash = "",
  ) =>
    Effect.gen(function* () {
      const emulator = new Emulator([]);
      const { target: tgt, authority: auth } = upgrade;
      for (const utxo of [
        tgt.mainUtxo,
        tgt.stagingUtxo,
        auth.thresholdUtxo,
        auth.techAuthForeverUtxo,
        auth.councilForeverUtxo,
        ...Option.toArray(auth.councilMainUtxo),
        feeUtxo,
        walletUtxo,
      ]) {
        emulator.addUtxo(utxo);
      }
      emulator.accounts.set(
        RewardAccount.fromCredential(
          {
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(auth.govAuth.hash()),
          },
          NetworkId.Mainnet,
        ),
        { balance: 0n },
      );
      const ctx = frozen(
        "upgrade",
        NetworkId.Mainnet,
        emulator.params,
        { address: deployer, utxos: [walletUtxo] },
        { ...upgrade, newHash, registerLogic: Option.none<Script>() },
      );
      const tx = yield* compile(plan(ctx), ctx);
      const [signature] = yield* signTransaction(tx.getId(), [deployerKey]);
      const witnesses = tx.witnessSet();
      witnesses.setVkeys(
        CborSet.fromCore([[...signature]], (core) =>
          VkeyWitness.fromCore(core),
        ),
      );
      tx.setWitnessSet(witnesses);
      yield* Effect.promise(() => emulator.submitTransaction(tx));
      emulator.awaitTransactionConfirmation(tx.getId());
      return emulator;
    });

  const upgrade = (
    tgt: TwoStageTarget,
    auth: GovernanceAuthority,
    field: UpgradeField,
  ): Upgrade => ({
    target: tgt,
    authority: auth,
    feeUtxo,
    field,
    feePadding: 0n,
    expectedWitnesses: 1,
  });

  it.live(
    "reserve promote-Auth via the main authority moves the staged auth and keeps the other fields",
    () =>
      Effect.gen(function* () {
        const main = yield* authority("Main");
        expect(main.requirements).toEqual({
          techAuth: { required: 6, total: 9 },
          council: { required: 4, total: 6 },
        });
        const tgt = reserve();
        const ledger = yield* onLedger(upgrade(tgt, main, "Auth"), planPromote);
        const [logic, , mainAuth] = tgt.mainState;
        expect(stateHolding(ledger, reserveTwoStage, MAIN_TOKEN_HEX)).toEqual([
          logic,
          "",
          tgt.stagingState[2],
          "",
          0n,
          0n,
        ]);
        expect(mainAuth).not.toBe(tgt.stagingState[2]);
      }),
  );

  it.live("council stage-Auth via the main authority validates", () =>
    Effect.gen(function* () {
      yield* onLedger(
        upgrade(
          target(councilTwoStage, snap.councilMain, snap.councilStaging),
          yield* authority("Main"),
          "Auth",
        ),
        planStage,
        "cd".repeat(28),
      );
    }),
  );

  it.live(
    "tech-auth stage-Auth via the staging authority references the council main and uses the staging threshold",
    () =>
      Effect.gen(function* () {
        const staging = yield* authority("Staging");
        expect(staging.requirements.techAuth.required).toBe(5);
        expect(staging.requirements.council.required).toBe(0);
        yield* onLedger(
          upgrade(
            target(techAuthTwoStage, snap.techAuthMain, snap.techAuthStaging),
            staging,
            "Auth",
          ),
          planStage,
          "cd".repeat(28),
        );
      }),
  );

  it.live.each([
    ["Logic", "ce".repeat(28)],
    ["MitigationLogic", "d1".repeat(28)],
    ["MitigationAuth", "d2".repeat(28)],
  ] satisfies [UpgradeField, string][])(
    "reserve stage-%s, then promote it: only that field and its round move",
    ([field, hash]) =>
      Effect.gen(function* () {
        const tgt = reserve();
        const stagingAuthority = yield* authority(
          field === "Logic" ? "Staging" : "Main",
        );
        const staged = yield* onLedger(
          upgrade(tgt, stagingAuthority, field),
          planStage,
          hash,
        );
        const nextStaging = nextStagingState(field, tgt.stagingState, hash);
        expect(
          stateHolding(staged, reserveTwoStage, STAGING_TOKEN_HEX),
        ).toEqual(nextStaging);
        const promoted = yield* onLedger(
          upgrade(
            target(
              reserveTwoStage,
              snap.reserveMain,
              withState(snap.reserveStaging, nextStaging, "b6"),
            ),
            yield* authority("Main"),
            field,
          ),
          planPromote,
        );
        expect(stateHolding(promoted, reserveTwoStage, MAIN_TOKEN_HEX)).toEqual(
          promotedMainState(field, tgt.mainState, nextStaging),
        );
      }),
  );

  /** The compile of the plan, which must fail in the named purpose. */
  const refused = (
    upgradeOf: Effect.Effect<Upgrade, unknown>,
    plan: typeof planStage | typeof planPromote,
    newHash: string,
    purpose: RegExp,
  ) =>
    Effect.gen(function* () {
      const value = yield* upgradeOf;
      const ctx = frozen(
        "upgrade",
        NetworkId.Mainnet,
        new Emulator([]).params,
        { address: deployer, utxos: [walletUtxo] },
        { ...value, newHash, registerLogic: Option.none<Script>() },
      );
      const error = yield* Effect.flip(compile(plan(ctx), ctx));
      expect(error._tag).toBe("TxBuildError");
      expect(error.traces.join("\n")).toMatch(purpose);
    });

  it.live(
    "a council witness over the wrong signers is refused by gov auth",
    () =>
      Effect.gen(function* () {
        const council = yield* decodeSigners(
          snap.councilForever.output().datum()!.asInlineData()!,
        );
        yield* refused(
          Effect.map(authority("Main", council.slice(0, 2)), (auth) =>
            upgrade(reserve(), auth, "Auth"),
          ),
          planPromote,
          "",
          /Withdraw\[0\][\s\S]*Validator returned false/,
        );
      }),
  );

  it.live(
    "a MitigationLogic promote over a main that already has one is refused",
    () =>
      Effect.gen(function* () {
        const tgt = reserve();
        const [logic, , auth, mitigationAuth, round, logicRound] =
          tgt.mainState;
        yield* refused(
          Effect.map(authority("Main"), (main) =>
            upgrade(
              target(
                reserveTwoStage,
                withState(
                  snap.reserveMain,
                  [
                    logic,
                    "d0".repeat(28),
                    auth,
                    mitigationAuth,
                    round,
                    logicRound,
                  ],
                  "b7",
                ),
                withState(
                  snap.reserveStaging,
                  nextStagingState(
                    "MitigationLogic",
                    tgt.stagingState,
                    "d1".repeat(28),
                  ),
                  "b6",
                ),
              ),
              main,
              "MitigationLogic",
            ),
          ),
          planPromote,
          "",
          /Spend\[\d+\]/,
        );
      }),
  );

  it.live("a 27-byte logic hash is refused by the two-stage validator", () =>
    refused(
      Effect.map(authority("Main"), (main) =>
        upgrade(reserve(), main, "Logic"),
      ),
      planStage,
      "ce".repeat(27),
      /Spend\[\d+\]/,
    ),
  );
});

describe("row 17: stage-upgrade on preprod acts on the record", () => {
  /** A record root holding a copy of preprod's record; its node_modules links the repository's, so the bindings resolve their packages. */
  const recordRoot = () => {
    const root = mkdtempSync(join(tmpdir(), "deployed-scripts-"));
    symlinkSync(resolve("node_modules"), join(root, "node_modules"));
    mkdirSync(join(root, "preprod"));
    for (const file of [
      "plutus.json",
      "versions.json",
      "contract_blueprint.ts",
    ]) {
      copyFileSync(
        join("deployed-scripts/preprod", file),
        join(root, "preprod", file),
      );
    }
    return root;
  };
  const hashesOf = (path: string) =>
    new Map(
      (
        JSON.parse(readFileSync(path, "utf-8")) as {
          validators: { title: string; hash: string }[];
        }
      ).validators.map((v) => [v.title, v.hash]),
    );

  it.live(
    "the forevers, the staging threshold and gov auth come from the record; a build-only logic is copied in and tracked as staged",
    () =>
      Effect.gen(function* () {
        const root = recordRoot();
        const recorded = hashesOf("deployed-scripts/preprod/plutus.json");
        const built = hashesOf("plutus-preprod.json");
        const newLogic = built.get(
          "committee_bridge.committee_bridge_logic.else",
        )!;
        const base = yield* setup("preprod", root);
        const tx = yield* Effect.provide(
          stageUpgradeProgram({
            network: "preprod",
            outputDir: tmp,
            outputFile: "preprod-stage-tx.json",
            validator: "reserve",
            newLogicHash: newLogic as ScriptHash,
            txHash: "f0".repeat(32) as TxHash,
            txIndex: 0 as TxIndex,
            feePadding: 50_000n,
            sign: false,
          }),
          base.layer,
        );

        const withdrawn = [...(tx.body().withdrawals()?.keys() ?? [])].map(
          (account) => RewardAccount.toHash(account),
        );
        const stagingGovAuth = "gov_auth.staging_gov_auth.else";
        expect(withdrawn).toEqual([recorded.get(stagingGovAuth)]);
        expect(recorded.get(stagingGovAuth)).not.toBe(
          built.get(stagingGovAuth),
        );
        const referenced = new Set(
          tx
            .body()
            .referenceInputs()
            ?.values()
            .map((input) => String(input.transactionId()).slice(0, 2)),
        );
        // The forevers (d0, d1), the staging threshold (d9) and the council main (e0), all at the record's addresses.
        expect(referenced).toEqual(new Set(["d0", "d1", "d9", "e0", "e5"]));

        const versions = JSON.parse(
          readFileSync(join(root, "preprod", "versions.json"), "utf-8"),
        ) as { staged: string[] };
        expect(versions.staged).toEqual(["committee_bridge_logic"]);
        expect(
          hashesOf(join(root, "preprod", "plutus.json")).get(
            "committee_bridge.committee_bridge_logic.else",
          ),
        ).toBe(newLogic);
        expect(base.output.lines).toContain(
          "Tracked committee_bridge_logic as staged in versions.json",
        );
      }),
  );

  it.live(
    "a build logic whose name the record promotes under another hash is refused",
    () =>
      Effect.gen(function* () {
        const base = yield* setup("preprod", recordRoot());
        const reserveLogic = hashesOf("plutus-preprod.json").get(
          "reserve.reserve_logic.else",
        )!;
        const error = yield* Effect.flip(
          Effect.provide(
            stageUpgradeProgram({
              network: "preprod",
              outputDir: tmp,
              outputFile: "x.json",
              validator: "reserve",
              newLogicHash: reserveLogic as ScriptHash,
              txHash: "f0".repeat(32) as TxHash,
              txIndex: 0 as TxIndex,
              feePadding: 50_000n,
              sign: false,
            }),
            base.layer,
          ),
        );
        expect(error).toMatchObject({
          _tag: "PreconditionFailed",
          refusal: { _tag: "PromotedLogicMoved", name: "reserve_logic" },
        });
      }),
  );
});

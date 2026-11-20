/**
 * deploy and deploy-staging-track.
 * - L2: on one chain state (helpers/deploy-scenario.ts), each step's plan
 *   equals the reference's (tests/golden/deploy/, written by the reference).
 * - L3: a full deploy, a cnight-minting deploy and the staging track build
 *   over the emulator, and sign-and-submit gets every transaction of each
 *   file accepted in order: each is planned on the change the previous one
 *   leaves (the fold), so none spends what an earlier one spent.
 * - The record: a full deploy on a test environment replaces it with the
 *   build; a --components deploy extends it; on preprod a validator the
 *   record promotes is refused before any chain read.
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
  HexBlob,
  NetworkId,
  SLOT_CONFIG_NETWORK,
  Transaction,
  TxCBOR,
} from "@blaze-cardano/core";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option, Result } from "effect";
import { HttpClient } from "effect/http";
import { Provider, utxoAmong } from "../cli/chain";
import {
  DeployedScripts,
  DeployerAddress,
  type Environment,
  Profile,
  reservedRefs,
} from "../cli/config";
import { ContractResolver, DEPLOY_COMPONENTS } from "../cli/contracts/resolver";
import {
  DEPLOY_STEPS,
  deployProgram,
  deployStagingTrackProgram,
  planDeployment,
  STAGING_STEPS,
  STAGING_TRACK_COMPONENTS,
  type Step,
  type StepSetup,
} from "../cli/deploy";
import { parseSigners } from "../cli/input";
import { Keys } from "../cli/keys";
import { signAndSubmitProgram, writeTransactionFile } from "../cli/signing";
import type { PlanningContext } from "../cli/tx";
import { deployScenario } from "./helpers/deploy-scenario";
import { captureOutput } from "./helpers/output";
import { planJson } from "./helpers/wallet-scenario";

const tmp = mkdtempSync(join(tmpdir(), "deploy-"));

/** A record root holding a copy of `environment`'s record; its node_modules links the repository's, so the bindings resolve their packages. */
const recordRoot = (environment: Environment) => {
  const root = mkdtempSync(join(tmpdir(), "deployed-scripts-"));
  symlinkSync(resolve("node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, environment));
  for (const file of [
    "plutus.json",
    "versions.json",
    "contract_blueprint.ts",
  ]) {
    copyFileSync(
      join("deployed-scripts", environment, file),
      join(root, environment, file),
    );
  }
  return root;
};

/** The scenario over `environment`'s profile, and every service a command needs; `root` is the record root. */
const setup = (
  environment: Environment,
  root?: string,
  oneShotCoins?: bigint,
) =>
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
    const config = yield* Effect.provide(
      Effect.flatMap(Profile, (profile) => profile.config),
      resolver,
    );
    const scenario = deployScenario(
      reservedRefs(config),
      oneShotCoins === undefined
        ? undefined
        : {
            coins: oneShotCoins,
            collateral: `${config.collateral_utxo_hash}#${config.collateral_utxo_index}`,
          },
    );
    const emulator = new Emulator([]);
    for (const utxo of scenario.utxos) emulator.addUtxo(utxo);
    const output = captureOutput();
    const layer = Layer.mergeAll(
      Layer.provide(
        Provider.over(new EmulatorProvider(emulator), environment),
        Layer.succeed(HttpClient.HttpClient)(
          HttpClient.make(() => Effect.die("no HTTP in this test")),
        ),
      ),
      resolver,
      DeployerAddress.layer(environment),
      Keys.layer,
      ConfigProvider.layer(ConfigProvider.fromUnknown(scenario.env)),
      NodeServices.layer,
      deployedScripts,
      output.layer,
    );
    return { scenario, config, emulator, layer, output, resolver };
  });

type Base = Effect.Success<ReturnType<typeof setup>>;

const THRESHOLDS = {
  techAuth: { numerator: 2n, denominator: 3n },
  council: { numerator: 2n, denominator: 3n },
  councilStaging: { numerator: 1n, denominator: 3n },
  techAuthStaging: { numerator: 1n, denominator: 2n },
};

/** A step's plan from its deployment over a frozen context of the scenario. */
const stepPlan = (base: Base, step: Step) =>
  Effect.provide(
    Effect.gen(function* () {
      const blueprint = (yield* ContractResolver).contracts("creates");
      const instances = yield* blueprint.instances;
      const wallet = {
        address: base.scenario.deployer,
        utxos: base.scenario.utxos,
      };
      const signers = (variable: "TECH_AUTH_SIGNERS" | "COUNCIL_SIGNERS") =>
        Result.getOrThrow(parseSigners(variable, base.scenario.env[variable]));
      const setupOf: StepSetup = {
        environment: "emulator",
        blueprint,
        instances,
        techAuthSigners: signers("TECH_AUTH_SIGNERS"),
        councilSigners: signers("COUNCIL_SIGNERS"),
        collateral: Result.getOrThrow(
          utxoAmong(
            wallet,
            base.config.collateral_utxo_hash,
            base.config.collateral_utxo_index,
          ),
        ),
        govAuth: instances.govAuth.Script.hash(),
        stagingGovAuth: instances.stagingGovAuth.Script.hash(),
        thresholds: THRESHOLDS,
      };
      const deployment = yield* step.deployment(
        setupOf,
        Result.getOrThrow(utxoAmong(wallet, ...step.oneShot(base.config))),
      );
      const ctx: PlanningContext<typeof deployment> = {
        command: "deploy",
        networkId: NetworkId.Testnet,
        slotConfig: SLOT_CONFIG_NETWORK.Preview,
        parameters: base.emulator.params,
        wallet,
        reserved: new Set(),
        contracts: [],
        resolved: deployment,
      };
      return planDeployment(ctx);
    }),
    base.layer,
  );

const golden = (name: string) =>
  readFileSync(`tests/golden/deploy/${name}-plan.json`, "utf-8").trimEnd();

describe("plans equal the reference's for the same inputs (L2)", () => {
  it.live.each(DEPLOY_COMPONENTS)("deploy %s", (component) =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const plan = yield* stepPlan(base, DEPLOY_STEPS[component]);
      expect(planJson(plan)).toBe(golden(component));
    }),
  );

  it.live.each(STAGING_TRACK_COMPONENTS)("staging track %s", (component) =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const plan = yield* stepPlan(base, STAGING_STEPS[component]);
      expect(planJson(plan)).toBe(golden(`staging-${component}`));
    }),
  );
});

describe("every transaction of each file is accepted by the emulator ledger, in order (L3)", () => {
  /** Sign and submit a deployment file with the deployer key. */
  const submitted = (base: Base, path: string) =>
    Effect.provide(
      signAndSubmitProgram({
        signingKey: "SIGNING_PRIVATE_KEY",
        signDeployer: true,
        jsonFile: path,
      }),
      base.layer,
    );

  const deployInput = (outputDir: string) => ({
    network: "emulator" as const,
    outputDir,
    techAuthThreshold: Option.none(),
    councilThreshold: Option.none(),
    councilStagingThreshold: Option.none(),
    techAuthStagingThreshold: Option.none(),
    components: Option.none(),
  });

  it.live("a full deploy: the twelve governance transactions", () =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const outputDir = mkdtempSync(join(tmp, "full-"));
      const built = yield* Effect.provide(
        deployProgram(deployInput(outputDir)),
        base.layer,
      );
      expect(built).toHaveLength(12);
      yield* submitted(
        base,
        join(outputDir, "emulator", "deployment-transactions.json"),
      );
      for (const { file } of built) {
        expect(base.output.lines).toContain(
          `Confirmed: ${file.description} - ${file.txHash}`,
        );
      }
    }),
  );

  it.live(
    "one-shots too small to pay their own way: each transaction spends the change the previous one left",
    () =>
      Effect.gen(function* () {
        const base = yield* setup("emulator", undefined, 2_000_000n);
        const outputDir = mkdtempSync(join(tmp, "chained-"));
        const built = yield* Effect.provide(
          deployProgram(deployInput(outputDir)),
          base.layer,
        );
        const inputsOf = (cbor: string) =>
          Transaction.fromCbor(TxCBOR(HexBlob(cbor)))
            .body()
            .inputs()
            .values()
            .map((input) => String(input.transactionId()));
        for (const [i, { file }] of built.entries()) {
          if (i > 0) {
            expect(inputsOf(file.cborHex)).toContain(built[i - 1].file.txHash);
          }
        }
        // The Blaze emulator takes no transaction that spends from its mempool, so each is submitted once the previous one is on the ledger; a node takes the chain from the one file.
        for (const { file } of built) {
          const path = join(outputDir, `${file.description}.json`);
          yield* Effect.provide(
            writeTransactionFile(
              path,
              Transaction.fromCbor(TxCBOR(HexBlob(file.cborHex))),
              false,
              file.description,
            ),
            NodeServices.layer,
          );
          yield* submitted(base, path);
          expect(base.output.lines).toContain(
            `Confirmed: ${file.description} - ${file.txHash}`,
          );
        }
      }),
  );

  it.live("deploy --components cnight-minting", () =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const outputDir = mkdtempSync(join(tmp, "cnight-"));
      const built = yield* Effect.provide(
        deployProgram({
          ...deployInput(outputDir),
          components: Option.some(["cnight-minting"] as const),
        }),
        base.layer,
      );
      expect(built.map(({ file }) => file.description)).toEqual([
        "cnight-minting-deployment",
      ]);
      yield* submitted(
        base,
        join(outputDir, "emulator", "deployment-transactions.json"),
      );
      expect(base.output.lines).toContain(
        `Confirmed: cnight-minting-deployment - ${built[0].file.txHash}`,
      );
    }),
  );

  it.live("deploy-staging-track: the six staging forevers", () =>
    Effect.gen(function* () {
      const base = yield* setup("emulator");
      const outputDir = mkdtempSync(join(tmp, "staging-"));
      const built = yield* Effect.provide(
        deployStagingTrackProgram({
          network: "emulator",
          outputDir,
          components: Option.none(),
        }),
        base.layer,
      );
      expect(built).toHaveLength(6);
      yield* submitted(
        base,
        join(
          outputDir,
          "emulator",
          "staging-track-deployment-transactions.json",
        ),
      );
      for (const { file } of built) {
        expect(base.output.lines).toContain(
          `Confirmed: ${file.description} - ${file.txHash}`,
        );
      }
    }),
  );
});

describe("the record", () => {
  const plutusOf = (path: string) =>
    JSON.parse(readFileSync(path, "utf-8")) as {
      validators: { title: string; hash: string }[];
    };
  const versionsOf = (root: string, environment: string) =>
    JSON.parse(
      readFileSync(join(root, environment, "versions.json"), "utf-8"),
    ) as { promoted: string[]; staged: string[] };

  it.live(
    "a full deploy on a test environment replaces it with the build",
    () =>
      Effect.gen(function* () {
        const root = recordRoot("devnet");
        const base = yield* setup("devnet", root);
        yield* Effect.provide(
          deployProgram({
            network: "devnet",
            outputDir: mkdtempSync(join(tmp, "devnet-full-")),
            techAuthThreshold: Option.none(),
            councilThreshold: Option.none(),
            councilStagingThreshold: Option.none(),
            techAuthStagingThreshold: Option.none(),
            components: Option.none(),
          }),
          base.layer,
        );
        expect(
          plutusOf(join(root, "devnet", "plutus.json")).validators,
        ).toEqual(plutusOf("plutus-devnet.json").validators);
        expect(versionsOf(root, "devnet").staged).toEqual([]);
        expect(
          base.output.lines.some((line) =>
            line.startsWith("Deployment scripts saved to"),
          ),
        ).toBe(true);
      }),
  );

  it.live(
    "a --components deploy extends it: only what the run creates is taken from the build",
    () =>
      Effect.gen(function* () {
        const root = recordRoot("devnet");
        const before = plutusOf(join(root, "devnet", "plutus.json"));
        const base = yield* setup("devnet", root);
        yield* Effect.provide(
          deployProgram({
            network: "devnet",
            outputDir: mkdtempSync(join(tmp, "devnet-main-gov-")),
            techAuthThreshold: Option.none(),
            councilThreshold: Option.none(),
            councilStagingThreshold: Option.none(),
            techAuthStagingThreshold: Option.none(),
            components: Option.some(["main-gov"] as const),
          }),
          base.layer,
        );
        const after = plutusOf(join(root, "devnet", "plutus.json"));
        const built = plutusOf("plutus-devnet.json");
        const title = "thresholds.main_gov_threshold.else";
        const hashOf = (p: typeof after, t: string) =>
          p.validators.find((v) => v.title === t)?.hash;
        expect(hashOf(after, title)).toBe(hashOf(built, title));
        for (const { title: other, hash } of before.validators) {
          if (!other.startsWith("thresholds.main_gov_threshold")) {
            expect(hashOf(after, other)).toBe(hash);
          }
        }
      }),
  );

  it.live(
    "on preprod a validator the record promotes is refused before any chain read",
    () =>
      Effect.gen(function* () {
        const base = yield* setup("preprod", recordRoot("preprod"));
        const error = yield* Effect.flip(
          Effect.provide(
            deployProgram({
              network: "preprod",
              outputDir: mkdtempSync(join(tmp, "preprod-")),
              techAuthThreshold: Option.none(),
              councilThreshold: Option.none(),
              councilStagingThreshold: Option.none(),
              techAuthStagingThreshold: Option.none(),
              components: Option.some(["reserve"] as const),
            }),
            base.layer,
          ),
        );
        expect(error).toMatchObject({
          _tag: "PreconditionFailed",
          command: "deploy",
          refusal: { _tag: "Promoted", environment: "preprod" },
        });
      }),
  );
});

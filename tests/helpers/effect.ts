/**
 * Run CLI functions in tests against real layers; the only test-side
 * runtime entry.
 *
 * Two modes. Local (the default, and what CI runs): the emulator only, no
 * network, and Settings over LOCAL_ENV, never the process environment or
 * .env (Bun loads .env into process.env on a developer machine). Preview
 * (`TEST_NETWORK=preview`, `just test-preview`): Settings over the process
 * environment with .env as the fallback, as the CLI root's EnvLive reads it, and the
 * chain-facing tests (`describe.if(onPreview)`) run against preview.
 */
import { createHash } from "crypto";
import {
  blake2b_224,
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  HexBlob,
} from "@blaze-cardano/core";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import { FetchHttpClient, FileSystem } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { ConfigProvider, Effect, Either, HashMap, Layer, Logger } from "effect";
import type { CliError } from "../../cli/errors";
import { Settings, SettingsLive } from "../../cli/config/settings";
import type { Environment } from "../../cli/config/network-mapping";
import { Blueprint, BlueprintLive } from "../../cli/contracts/contracts";
import { Provider, ProviderOver } from "../../cli/chain/provider";
import { DEPLOYER_ONLY } from "../../cli/chain/transaction";
import { completeBuilder } from "../../cli/chain/complete-tx";
import { buildSimpleTx } from "../../cli/wallet/simple-tx";
import { DeployedScripts } from "../../cli/contracts/versions";
import { Output } from "../../cli/output";
import { DotEnvFallback, type CliServices } from "../../cli/run";
import { FEE_TX, feeUtxo, keyAddress } from "./fixtures";

/** One log record a test can assert on. */
interface CapturedLog {
  readonly level: string;
  readonly message: string;
  readonly annotations: Record<string, unknown>;
}

/** Captured output for tests: every line, written file and log record, in order. */
interface OutputCapture {
  readonly lines: string[];
  readonly files: Map<string, unknown>;
  readonly logs: CapturedLog[];
}

/** A logger that records into a capture instead of printing. */
export const LoggerCaptured = (capture: OutputCapture) =>
  Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ logLevel, message, annotations }) => {
      capture.logs.push({
        level: logLevel.label,
        message: Array.isArray(message)
          ? message.map(String).join(" ")
          : String(message),
        annotations: Object.fromEntries(HashMap.toEntries(annotations)),
      });
    }),
  );

/** Output that records into a capture instead of printing. */
export const OutputCaptured = (capture: OutputCapture) =>
  Layer.succeed(Output, {
    log: (line) => Effect.sync(() => void capture.lines.push(line)),
    stderr: (line) => Effect.sync(() => void capture.lines.push(line)),
    success: (message) =>
      Effect.sync(() => void capture.lines.push(`✅ ${message}\n`)),
    error: (message) =>
      Effect.sync(() => void capture.lines.push(`❌ ${message}\n`)),
    info: (message) =>
      Effect.sync(() => void capture.lines.push(`ℹ️  ${message}`)),
    progress: (message) =>
      Effect.sync(() => void capture.lines.push(`⏳ ${message}`)),
    writeJson: (path, data) =>
      Effect.sync(() => void capture.files.set(path, data)),
    writeText: (path, text) =>
      Effect.sync(() => void capture.files.set(path, text)),
  });

/** Run an effect with the given layer. */
export const runTest = <A, E, R extends CliServices, LE>(
  layer: Layer.Layer<R, LE>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, layer));

/** A fresh output capture. */
export const captureOutput = (): OutputCapture => ({
  lines: [],
  files: new Map(),
  logs: [],
});

/** The real Bun platform and the fetch HttpClient, for tests that touch files or HTTP. */
export const PlatformLive = Layer.mergeAll(
  BunContext.layer,
  FetchHttpClient.layer,
);

/** True under `TEST_NETWORK=preview`: the chain-facing tests run against preview with the actual .env. */
export const onPreview = process.env.TEST_NETWORK === "preview";

/** 32 bytes of hex from a label; the local mode's keys come from these fixed seeds. */
const seed = (label: string) =>
  createHash("blake2b512")
    .update(`midnight-reserve-contracts/tests/${label}`)
    .digest("hex")
    .slice(0, 64);

const keyHash = (privateKey: string) =>
  blake2b_224(HexBlob(derivePublicKey(Ed25519PrivateNormalKeyHex(privateKey))));

const deployerKey = seed("deployer");

const groupKeys = (group: string) =>
  [1, 2, 3].map((n) => seed(`${group}-${n}`));

/** Every env value the local tests read, derived in code. */
const LOCAL_ENV: Readonly<Record<string, string>> = {
  DEPLOYER_ADDRESS: keyAddress(keyHash(deployerKey)).toBech32(),
  SIGNING_PRIVATE_KEY: deployerKey,
  TECH_AUTH_PRIVATE_KEYS: groupKeys("tech-auth").join(","),
  COUNCIL_PRIVATE_KEYS: groupKeys("council").join(","),
  TECH_AUTH_THRESHOLD: "1/2",
  COUNCIL_THRESHOLD: "3/5",
  TECH_AUTH_STAGING_THRESHOLD: "2/5",
  COUNCIL_STAGING_THRESHOLD: "1/3",
  SIMPLE_TX_COUNT: "2",
  SIMPLE_TX_AMOUNT: "3000000",
  PERMISSIONED_CANDIDATES: `[ { sidechain_pub_key:${seed("sidechain")}, aura_pub_key:${seed("aura")}, grandpa_pub_key:${seed("grandpa")}, beefy_pub_key:${seed("beefy")} } ]`,
  BRIDGE_ACTIVATION_BLOCK: "1200",
  BRIDGE_MMR_ROOT: seed("bridge-mmr-root"),
  BRIDGE_CURRENT_COMMITTEE: `4:5:${seed("bridge-current")}`,
  BRIDGE_NEXT_COMMITTEE: `5:7:${seed("bridge-next")}`,
  BRIDGE_MAX_FEE_BASE: "650000",
  BRIDGE_MAX_FEE_PER_SIGNER: "13000",
  BLOCKFROST_PREVIEW_API_KEY: `preview${seed("blockfrost").slice(0, 32)}`,
  KUPO_URL: "http://127.0.0.1:1442",
  OGMIOS_URL: "ws://127.0.0.1:1337",
};

/** An env value in the current mode: LOCAL_ENV, or the process environment (with .env) on preview. */
export const testEnv = (key: string): string => {
  const value = onPreview ? process.env[key] : LOCAL_ENV[key];
  if (value === undefined || value === "") {
    throw new Error(
      `${key} is not set for the ${onPreview ? "preview (.env)" : "local"} tests`,
    );
  }
  return value;
};

/** A ConfigProvider over exactly these env values. */
export const EnvValues = (values: Readonly<Record<string, string>>) =>
  Layer.setConfigProvider(
    ConfigProvider.fromMap(new Map(Object.entries(values))),
  );

/** The mode's ConfigProvider: LOCAL_ENV alone, or the process environment with .env as the fallback. */
export const TestEnvLive = onPreview
  ? DotEnvFallback(".env")
  : EnvValues(LOCAL_ENV);

/** The env's Settings over the real Bun platform and the mode's env values. */
export const SettingsOver = (env: Environment) =>
  Layer.mergeAll(Layer.provide(SettingsLive(env), PlatformLive), TestEnvLive);

/** The env's Settings over the real Bun platform and exactly these env values, in either mode. */
export const SettingsWith = (
  env: Environment,
  values: Readonly<Record<string, string>>,
) =>
  Layer.mergeAll(
    Layer.provide(SettingsLive(env), PlatformLive),
    EnvValues(values),
  );

/** The contract instances of the emulator's build blueprint. */
export const buildInstances = () =>
  runTest(
    BlueprintLive("emulator", "build"),
    Effect.flatMap(Blueprint, (b) => b.instances),
  );

/** The emulator's aiken.toml profile (default). */
export const emulatorProfile = () =>
  runTest(
    SettingsOver("emulator"),
    Effect.flatMap(Settings, (s) => s.profile),
  );

/** Preview Settings and the real fetch client, for the preview-only tests. */
export const PreviewLive = Layer.mergeAll(
  SettingsOver("preview"),
  PlatformLive,
);

/** Snapshots under a temporary directory that lives as long as the layer, so no test writes the repository's deployed-scripts/. */
export const DeployedScriptsTemp = Layer.scoped(
  DeployedScripts,
  Effect.map(
    Effect.orDie(
      Effect.flatMap(FileSystem.FileSystem, (fs) =>
        fs.makeTempDirectoryScoped({ prefix: "deployed-scripts-" }),
      ),
    ),
    (root) => ({ root }),
  ),
).pipe(Layer.provide(BunContext.layer));

/** Every CLI service backed by an emulator, with captured output and the mode's env values, over the real Bun platform; "emulator" uses the default profile and the build blueprint. */
export const EmulatorLive = (
  emulator: Emulator,
  capture: OutputCapture,
  env: Environment = "emulator",
) =>
  Layer.mergeAll(
    SettingsOver(env),
    BlueprintLive(env, "build"),
    ProviderOver(new EmulatorProvider(emulator), env),
    OutputCaptured(capture),
    LoggerCaptured(capture),
    PlatformLive,
    DeployedScriptsTemp,
  );

/** Run the effect and return its failure, which must carry the tag. */
export const expectFailure = async <
  Tag extends CliError["_tag"],
  R extends CliServices,
  LE extends CliError = never,
>(
  layer: Layer.Layer<R, LE>,
  effect: Effect.Effect<unknown, CliError, R>,
  tag: Tag,
): Promise<Extract<CliError, { _tag: Tag }>> => {
  const error = await Effect.runPromise(
    Effect.flip(Effect.provide(effect, layer)),
  );
  const hasTag = (e: CliError): e is Extract<CliError, { _tag: Tag }> =>
    e._tag === tag;
  if (!hasTag(error)) {
    throw new Error(`expected ${tag}, got ${error._tag}`);
  }
  return error;
};

/** A fresh emulator program: captured output, the layer over the mode's env values, and the deployer funded by the `FEE_TX` UTxO. */
export const emulatorProgram = async (env: Environment = "emulator") => {
  const emulator = new Emulator([]);
  const capture = captureOutput();
  const layer = EmulatorLive(emulator, capture, env);
  const deployer = await runTest(
    layer,
    Effect.flatMap(Settings, (c) => c.deployerAddress),
  );
  const fee = feeUtxo(deployer, FEE_TX);
  emulator.addUtxo(fee);
  return { emulator, capture, layer, deployer, fee };
};

/** The deployer's unsigned payment of 5 ADA to itself, built and completed over the Provider. */
export const unsignedSimpleTx = Effect.gen(function* () {
  const provider = yield* Provider;
  const recipient = yield* Effect.flatMap(Settings, (s) => s.deployerAddress);
  const { maxTxSize } = yield* provider.use("getParameters", (p) =>
    p.getParameters(),
  );
  const blaze = yield* provider.blaze;
  return yield* completeBuilder(
    buildSimpleTx(blaze, { recipient, count: 1, amount: 5_000_000n }),
    "simple-tx",
    { maxTxSize, witnesses: DEPLOYER_ONLY },
  );
});

/** The error of a Left; a Right fails the test. */
export const leftOf = <A, E>(either: Either.Either<A, E>): E =>
  Either.getOrThrow(Either.flip(either));

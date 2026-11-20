/**
 * Where the CLI runs: the environment values it reads, the environments and
 * the aiken.toml profiles; the Profile service (the aiken.toml profile of an
 * environment with its one-shot and collateral UTxO references and the
 * cNIGHT asset); the DeployerAddress service; and the env intent, the
 * values a command installs that come from the environment.
 */
import { resolve } from "path";
import {
  Address,
  AssetId,
  NetworkId,
  SLOT_CONFIG_NETWORK,
  type SlotConfig,
} from "@blaze-cardano/core";
import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  FileSystem,
  Layer,
  Logger,
  LogLevel,
  Option,
  Redacted,
  References,
  Result,
} from "effect";
import * as TOML from "toml";
import { ConfigError } from "./errors";
import {
  type Hash32,
  parseCandidates,
  parseHash32,
  parseSigners,
  parseTxHash,
  parseTxIndex,
  type TxHash,
  type TxIndex,
  ZERO_HASH32,
} from "./input";

/** The repository root: aiken.toml, the build output, deployed-scripts/ and node_modules/. */
export const PROJECT_ROOT = resolve(import.meta.dirname, "..");

/**
 * The process environment, with the dotenv file at `dotEnvPath` as the
 * fallback for a variable the environment does not set. A variable set
 * empty in the environment is set: the file cannot bring it back (its
 * reader treats it as unset). A missing or unreadable file adds nothing.
 */
export const envLayer = (dotEnvPath: string) =>
  ConfigProvider.layer(
    Effect.map(
      Effect.orElseSucceed(
        ConfigProvider.fromDotEnv({ path: dotEnvPath }),
        () => ConfigProvider.fromUnknown({}),
      ),
      (dotEnv) =>
        ConfigProvider.orElse(
          ConfigProvider.fromEnv({ preserveEmptyStrings: true }),
          dotEnv,
        ),
    ),
  );

/** The directory that holds each environment's record, `<root>/<env>/`: the repository's deployed-scripts/, or a temporary directory in tests. */
export class DeployedScripts extends Context.Service<
  DeployedScripts,
  { readonly root: string }
>()("cli/DeployedScripts") {
  static readonly layer = Layer.succeed(this)({
    root: resolve(PROJECT_ROOT, "deployed-scripts"),
  });

  /** Records under `root`. */
  static readonly at = (root: string) => Layer.succeed(this)({ root });
}

/** The environments a command runs against, as `--network` takes them. */
export const ENVIRONMENTS = [
  "local",
  "emulator",
  "preview",
  "qanet",
  "govnet",
  "devnet",
  "preprod",
  "mainnet",
] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/** The aiken.toml profiles (`[config.<profile>]`) a build compiles for. */
export const PROFILES = [
  "default",
  "local",
  "preview",
  "qanet",
  "govnet",
  "devnet",
  "preprod",
  "mainnet",
] as const;

export type ProfileName = (typeof PROFILES)[number];

/** The NetworkId of an environment and its aiken.toml section; the emulator uses the default profile. */
export const environmentOf = (
  environment: Environment,
): {
  readonly networkId: NetworkId;
  readonly aikenConfigSection: ProfileName;
} => ({
  networkId: environment === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet,
  aikenConfigSection: environment === "emulator" ? "default" : environment,
});

/** The slot configuration of an environment's Cardano network: mainnet, preprod, or preview for every other environment. */
export const slotConfigOf = (environment: Environment): SlotConfig =>
  environment === "mainnet"
    ? SLOT_CONFIG_NETWORK.Mainnet
    : environment === "preprod"
      ? SLOT_CONFIG_NETWORK.Preprod
      : SLOT_CONFIG_NETWORK.Preview;

/** The address when it is on the environment's network; the failure is the reason. */
export const addressOn = (
  address: Address,
  environment: Environment,
): Effect.Effect<Address, string> => {
  const { networkId } = environmentOf(environment);
  return address.getNetworkId() === networkId
    ? Effect.succeed(address)
    : Effect.fail(
        `'${address.toBech32()}' is a ${NetworkId[address.getNetworkId()]} address; ${environment} is on ${NetworkId[networkId]}`,
      );
};

/** The UTxO references of an aiken.toml profile: `<name>_hash` (hex bytes) and `<name>_index` each. */
const ONE_SHOTS = [
  "technical_authority_one_shot",
  "council_one_shot",
  "reserve_one_shot",
  "ics_one_shot",
  "federated_operators_one_shot",
  "main_gov_one_shot",
  "staging_gov_one_shot",
  "main_council_update_one_shot",
  "main_tech_auth_update_one_shot",
  "main_federated_ops_update_one_shot",
  "terms_and_conditions_one_shot",
  "terms_and_conditions_threshold_one_shot",
  "cnight_minting_one_shot",
  "committee_bridge_one_shot",
  "committee_threshold_one_shot",
  "collateral_utxo",
  "reserve_staging_one_shot",
  "council_staging_one_shot",
  "ics_staging_one_shot",
  "technical_authority_staging_one_shot",
  "federated_operators_staging_one_shot",
  "terms_and_conditions_staging_one_shot",
  "reserve_logic_v2_init_one_shot",
  "reserve_staging_params_one_shot",
  "ics_logic_v2_one_shot",
  "council_logic_v2_one_shot",
  "technical_authority_logic_v2_one_shot",
  "federated_operators_logic_v2_one_shot",
  "terms_and_conditions_logic_v2_one_shot",
  "night_registration_one_shot",
] as const;

type OneShot = (typeof ONE_SHOTS)[number];

/** The aiken.toml profile of an environment. */
export type NetworkConfig = {
  readonly [K in OneShot as `${K}_hash`]: TxHash;
} & {
  readonly [K in OneShot as `${K}_index`]: TxIndex;
} & {
  readonly cnight_policy: string;
  readonly cnight_name: string;
};

/** Every UTxO the profile names, its one-shots and its collateral, as "txId#index": coin selection never spends them. */
export const reservedRefs = (config: NetworkConfig): ReadonlySet<string> =>
  new Set(
    ONE_SHOTS.map(
      (name) => `${config[`${name}_hash`]}#${config[`${name}_index`]}`,
    ),
  );

/** The cNIGHT asset of a profile: cnight_policy plus the UTF-8 cnight_name. */
export const cnightAssetId = (config: NetworkConfig): AssetId =>
  AssetId(
    config.cnight_policy + Buffer.from(config.cnight_name).toString("hex"),
  );

type Table = Record<string, unknown>;

const isTable = (value: unknown): value is Table =>
  typeof value === "object" && value !== null;

const invalid = (key: string, reason: string) =>
  new ConfigError({ source: "aiken.toml", key, reason });

const tableField = (source: Table, key: string, parent: string) => {
  const value = source[key];
  return isTable(value)
    ? Effect.succeed(value)
    : Effect.fail(invalid(`${parent}.${key}`, "expected a table"));
};

const HEX_BYTES = /^[0-9a-fA-F]*$/;

/** A `{ bytes, encoding = "hex" }` table as lower-case hex, the case the chain and the blueprint compare in. */
const bytesField = (source: Table, key: string, parent: string) =>
  Effect.flatMap(tableField(source, key, parent), (table) =>
    table.encoding !== "hex"
      ? Effect.fail(invalid(`${parent}.${key}.encoding`, 'expected "hex"'))
      : typeof table.bytes === "string" && HEX_BYTES.test(table.bytes)
        ? Effect.succeed(table.bytes.toLowerCase())
        : Effect.fail(invalid(`${parent}.${key}.bytes`, "expected hex")),
  );

/** Parse the profile of an environment out of aiken.toml text. */
export const parseNetworkConfig = (
  environment: Environment,
  tomlText: string,
): Effect.Effect<NetworkConfig, ConfigError> =>
  Effect.gen(function* () {
    const parsed: unknown = yield* Effect.try({
      try: () => TOML.parse(tomlText),
      catch: (cause) =>
        invalid("", cause instanceof Error ? cause.message : String(cause)),
    });
    if (!isTable(parsed)) {
      return yield* invalid("", "expected a top-level table");
    }
    const config = yield* tableField(parsed, "config", "");
    const section = environmentOf(environment).aikenConfigSection;
    const path = `config.${section}`;
    const profile = yield* tableField(config, section, "config");

    /** The two entries of a UTxO reference in the profile. */
    const oneShot = (name: OneShot) =>
      Effect.gen(function* () {
        const hex = yield* bytesField(profile, `${name}_hash`, path);
        const hash = yield* Effect.mapError(
          Effect.fromResult(parseTxHash(hex)),
          (reason) => invalid(`${path}.${name}_hash.bytes`, reason),
        );
        const index = profile[`${name}_index`];
        if (typeof index !== "number" || !Number.isInteger(index)) {
          return yield* invalid(`${path}.${name}_index`, "expected an integer");
        }
        const txIndex = yield* Effect.mapError(
          Effect.fromResult(parseTxIndex(String(index))),
          (reason) => invalid(`${path}.${name}_index`, reason),
        );
        return [
          [`${name}_hash`, hash],
          [`${name}_index`, txIndex],
        ] as const;
      });

    const refs = yield* Effect.forEach(ONE_SHOTS, oneShot);
    const cnightName = profile.cnight_name;
    if (typeof cnightName !== "string") {
      return yield* invalid(`${path}.cnight_name`, "expected a string");
    }
    return {
      ...Object.fromEntries(refs.flat()),
      cnight_policy: yield* bytesField(profile, "cnight_policy", path),
      cnight_name: cnightName,
    } as NetworkConfig;
  });

/** The aiken.toml profile of the command's environment. */
export class Profile extends Context.Service<
  Profile,
  {
    /** The profile, read from the repository's aiken.toml on each call. */
    readonly config: Effect.Effect<NetworkConfig, ConfigError>;
  }
>()("cli/Profile") {
  /** The environment's profile; aiken.toml is read through FileSystem on each use. */
  static readonly layer = (environment: Environment) =>
    Layer.effect(
      this,
      Effect.map(FileSystem.FileSystem, (fs) => ({
        config: Effect.flatMap(
          Effect.mapError(
            fs.readFileString(resolve(PROJECT_ROOT, "aiken.toml")),
            (cause) => invalid("", cause.message),
          ),
          (text) => parseNetworkConfig(environment, text),
        ),
      })),
    );
}

/** A ConfigError on an environment variable. */
export const envError = (key: string, reason: string) =>
  new ConfigError({ source: "env", key, reason });

/**
 * An environment variable through the fiber's ConfigProvider (envLayer in
 * the CLI); unset and empty both read as None. The providers fail on a flat
 * key only when it is missing, so any other failure is a defect.
 */
const optionalString = (name: string): Effect.Effect<Option.Option<string>> =>
  Effect.orDie(
    Effect.map(
      Config.option(Config.String(name)),
      Option.filter((value) => value !== ""),
    ),
  );

/** An environment variable through `parse`, or `fallback` when it is unset or empty; a value `parse` refuses is a ConfigError naming it. */
export const envOr = <A>(
  name: string,
  parse: (text: string) => Result.Result<A, string>,
  fallback: A,
): Effect.Effect<A, ConfigError> =>
  Effect.flatMap(
    optionalString(name),
    Option.match({
      onNone: () => Effect.succeed(fallback),
      onSome: (text) =>
        Effect.mapError(Effect.fromResult(parse(text)), (reason) =>
          envError(name, reason),
        ),
    }),
  );

/**
 * The logging the runtime edge installs: logs on stderr, so stdout carries
 * only a command's own output (`info --format json`), from the level of
 * LOG_LEVEL up (an Effect level name in any case, plus the Effect 3 CLI's
 * `Warning` and `OFF`; Info when unset). A bad LOG_LEVEL is a ConfigError, so
 * it fails every command. Read through the fiber's ConfigProvider.
 */
export const loggingLayer = Layer.unwrap(
  Effect.map(
    envOr(
      "LOG_LEVEL",
      (text) => {
        const lower = text.toLowerCase();
        const wanted =
          lower === "warning" ? "warn" : lower === "off" ? "none" : lower;
        const level = LogLevel.values.find(
          (candidate) => candidate.toLowerCase() === wanted,
        );
        return level === undefined
          ? Result.fail(
              `'${text}' is not a log level (${LogLevel.values.join(", ")})`,
            )
          : Result.succeed(level);
      },
      "Info",
    ),
    (level) =>
      Layer.mergeAll(
        Layer.succeed(References.MinimumLogLevel)(level),
        Layer.succeed(Logger.LogToStderr)(true),
      ),
  ),
);

/** An environment variable that must be set and not empty. */
export const requiredString = (
  name: string,
): Effect.Effect<string, ConfigError> =>
  Effect.flatMap(
    optionalString(name),
    Option.match({
      onNone: () => Effect.fail(envError(name, "required but not set")),
      onSome: Effect.succeed,
    }),
  );

/** A secret environment variable that must be set and not empty, Redacted from the read on. */
export const requiredSecret = (
  name: string,
): Effect.Effect<Redacted.Redacted<string>, ConfigError> =>
  Effect.flatMap(
    Effect.orDie(Config.option(Config.Redacted(name))),
    Option.match({
      onNone: () => Effect.fail(envError(name, "required but not set")),
      onSome: (secret) =>
        Redacted.value(secret) === ""
          ? Effect.fail(envError(name, "required but not set"))
          : Effect.succeed(secret),
    }),
  );

/** The deployer's address on local and the emulator when DEPLOYER_ADDRESS is unset. */
const LOCAL_DEPLOYER =
  "addr_test1qruhen60uwzpwnnr7gjs50z2v8u9zyfw6zunet4k42zrpr54mrlv55f93rs6j48wt29w90hlxt4rvpvshe55k5r9mpvqjv2wt4";

/** The deployer's address. */
export class DeployerAddress extends Context.Service<
  DeployerAddress,
  {
    /** DEPLOYER_ADDRESS, read on each call. */
    readonly address: Effect.Effect<Address, ConfigError>;
  }
>()("cli/DeployerAddress") {
  /** DEPLOYER_ADDRESS, which must be on the environment's network; unset, a fixed test address on local and the emulator. */
  static readonly layer = (environment: Environment) =>
    Layer.succeed(this)({
      address: Effect.gen(function* () {
        const text = yield* optionalString("DEPLOYER_ADDRESS");
        if (Option.isNone(text)) {
          return environment === "local" || environment === "emulator"
            ? Address.fromBech32(LOCAL_DEPLOYER)
            : yield* envError(
                "DEPLOYER_ADDRESS",
                `required for non-local environment '${environment}'`,
              );
        }
        const address = yield* Effect.try({
          try: () => Address.fromBech32(text.value),
          catch: (cause) =>
            envError(
              "DEPLOYER_ADDRESS",
              `'${text.value}' is not a bech32 address: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
        });
        const { networkId } = environmentOf(environment);
        return address.getNetworkId() === networkId
          ? address
          : yield* envError(
              "DEPLOYER_ADDRESS",
              `'${text.value}' is a ${NetworkId[address.getNetworkId()]} address; ${environment} is on ${NetworkId[networkId]}`,
            );
      }),
    });
}

/** COUNCIL_SIGNERS or TECH_AUTH_SIGNERS: the signers deploy installs, or a change command's new set. */
export const newSigners = (variable: "COUNCIL_SIGNERS" | "TECH_AUTH_SIGNERS") =>
  Effect.flatMap(requiredString(variable), (value) =>
    Effect.fromResult(parseSigners(variable, value)),
  );

/** PERMISSIONED_CANDIDATES: the federated operators deploy and change-federated-ops install. */
export const permissionedCandidates = Effect.flatMap(
  requiredString("PERMISSIONED_CANDIDATES"),
  (value) => Effect.fromResult(parseCandidates(value)),
);

/**
 * The first terms and conditions a deploy installs:
 * TERMS_AND_CONDITIONS_INITIAL_HASH (zeros when unset) and the hex of the
 * UTF-8 TERMS_AND_CONDITIONS_INITIAL_LINK (empty when unset).
 */
export const initialTermsAndConditions: Effect.Effect<
  { readonly hash: Hash32; readonly link: string },
  ConfigError
> = Effect.all({
  hash: Effect.flatMap(
    optionalString("TERMS_AND_CONDITIONS_INITIAL_HASH"),
    Option.match({
      onNone: () => Effect.succeed(ZERO_HASH32),
      onSome: (text) =>
        Effect.mapError(Effect.fromResult(parseHash32(text)), (reason) =>
          envError("TERMS_AND_CONDITIONS_INITIAL_HASH", reason),
        ),
    }),
  ),
  link: Effect.map(
    optionalString("TERMS_AND_CONDITIONS_INITIAL_LINK"),
    Option.match({
      onNone: () => "",
      onSome: (text) => Buffer.from(text).toString("hex"),
    }),
  ),
});

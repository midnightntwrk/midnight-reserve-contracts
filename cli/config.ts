/**
 * Where the CLI runs: the environment values it reads, the environments and
 * the aiken.toml profiles, and the Profile service, the aiken.toml profile
 * of an environment with its one-shot and collateral UTxO references and
 * the cNIGHT asset.
 */
import { resolve } from "path";
import { AssetId, NetworkId } from "@blaze-cardano/core";
import { ConfigProvider, Context, Effect, FileSystem, Layer } from "effect";
import * as TOML from "toml";
import { ConfigError } from "./errors";
import { parseTxHash, parseTxIndex, type TxHash, type TxIndex } from "./input";

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
  "reserve_logic_v2_one_shot",
  "ics_logic_v2_one_shot",
  "council_logic_v2_one_shot",
  "technical_authority_logic_v2_one_shot",
  "federated_operators_logic_v2_one_shot",
  "terms_and_conditions_logic_v2_one_shot",
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

/**
 * The aiken.toml profile of an environment: its one-shot and collateral
 * UTxO references and the cNIGHT asset. The parser returns Either; the
 * Profile service reads aiken.toml through FileSystem once.
 */
import { FileSystem } from "@effect/platform";
import { AssetId } from "@blaze-cardano/core";
import { resolve } from "path";
import { TOML } from "bun";
import { Context, Effect, Either, Layer } from "effect";
import { type Environment, environmentOf } from "./network-mapping";
import { ConfigError } from "../errors";
import {
  parseTxHash,
  parseTxIndex,
  type TxHash,
  type TxIndex,
  type TxRef,
  txRef,
} from "../input";
import { PROJECT_ROOT } from "../contracts/paths";

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

/** Every UTxO the profile names, its one-shots and its collateral: coin selection never spends them. */
export const reservedRefs = (config: NetworkConfig): ReadonlySet<TxRef> =>
  new Set(
    ONE_SHOTS.map((name) =>
      txRef(
        config[`${name}_hash` as `${OneShot}_hash`],
        config[`${name}_index` as `${OneShot}_index`],
      ),
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

const invalidReason = (key: string, reason: string) =>
  new ConfigError({ source: "aiken.toml", key, reason });

const invalid = (key: string, reason: string) =>
  Either.left(invalidReason(key, reason));

const tableField = (
  source: Table,
  key: string,
  parent: string,
): Either.Either<Table, ConfigError> => {
  const value = source[key];
  return isTable(value)
    ? Either.right(value)
    : invalid(`${parent}.${key}`, "expected a table");
};

const HEX_BYTES = /^[0-9a-fA-F]*$/;

/** A `{ bytes, encoding = "hex" }` table as lower-case hex, the case the chain and the blueprint compare in. */
const bytesField = (
  source: Table,
  key: string,
  parent: string,
): Either.Either<string, ConfigError> =>
  Either.flatMap(tableField(source, key, parent), (table) =>
    table.encoding !== "hex"
      ? invalid(`${parent}.${key}.encoding`, 'expected "hex"')
      : typeof table.bytes === "string" && HEX_BYTES.test(table.bytes)
        ? Either.right(table.bytes.toLowerCase())
        : invalid(`${parent}.${key}.bytes`, "expected hex"),
  );

const integerField = (
  source: Table,
  key: string,
  parent: string,
): Either.Either<number, ConfigError> => {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value)
    ? Either.right(value)
    : invalid(`${parent}.${key}`, "expected an integer");
};

const stringField = (
  source: Table,
  key: string,
  parent: string,
): Either.Either<string, ConfigError> => {
  const value = source[key];
  return typeof value === "string"
    ? Either.right(value)
    : invalid(`${parent}.${key}`, "expected a string");
};

/** Parse the profile of an environment out of aiken.toml text. */
export const parseNetworkConfig = (
  environment: Environment,
  tomlText: string,
): Either.Either<NetworkConfig, ConfigError> =>
  Either.gen(function* () {
    const parsed = yield* Either.try({
      try: (): unknown => TOML.parse(tomlText),
      catch: (cause) =>
        new ConfigError({
          source: "aiken.toml",
          key: "",
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    if (!isTable(parsed)) {
      return yield* invalid("", "expected a top-level table");
    }
    const config = yield* tableField(parsed, "config", "");
    const { aikenConfigSection: section } = environmentOf(environment);
    const path = `config.${section}`;
    const profile = yield* tableField(config, section, "config");

    /** The two entries of a UTxO reference in the profile. */
    const oneShot = (name: OneShot) =>
      Either.all([
        Either.flatMap(bytesField(profile, `${name}_hash`, path), (hex) =>
          Either.mapLeft(parseTxHash(hex), (reason) =>
            invalidReason(`${path}.${name}_hash.bytes`, reason),
          ),
        ),
        Either.flatMap(integerField(profile, `${name}_index`, path), (index) =>
          Either.mapLeft(parseTxIndex(String(index)), (reason) =>
            invalidReason(`${path}.${name}_index`, reason),
          ),
        ),
      ]).pipe(
        Either.map(([hash, index]) => [
          [`${name}_hash`, hash],
          [`${name}_index`, index],
        ]),
      );

    const refs = yield* Either.all(ONE_SHOTS.map(oneShot));
    return {
      ...Object.fromEntries(refs.flat()),
      cnight_policy: yield* bytesField(profile, "cnight_policy", path),
      cnight_name: yield* stringField(profile, "cnight_name", path),
    } as NetworkConfig;
  });

/** The aiken.toml profile of the command's environment. */
export class Profile extends Context.Tag("cli/Profile")<
  Profile,
  {
    /** The profile, read from the repository's aiken.toml once. */
    readonly config: Effect.Effect<NetworkConfig, ConfigError>;
  }
>() {
  /** The profile, through the service. */
  static readonly config: Effect.Effect<NetworkConfig, ConfigError, Profile> =
    Effect.flatMap(Profile, (p) => p.config);
}

/** The environment's profile; aiken.toml is read through FileSystem on first use. */
export const ProfileLive = (
  environment: Environment,
): Layer.Layer<Profile, never, FileSystem.FileSystem> =>
  Layer.effect(
    Profile,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const read = Effect.flatMap(
        Effect.mapError(
          fs.readFileString(resolve(PROJECT_ROOT, "aiken.toml")),
          (cause) =>
            new ConfigError({
              source: "aiken.toml",
              key: "",
              reason: cause.message,
            }),
        ),
        (text) => parseNetworkConfig(environment, text),
      );
      return { config: yield* Effect.cached(read) };
    }),
  );

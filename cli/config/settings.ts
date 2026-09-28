/**
 * Configuration: the aiken.toml profile of an environment and the values
 * the CLI reads from the environment. Environment values come through the
 * fiber's ConfigProvider (the process environment with .env as a fallback
 * in the CLI, a literal map in tests); secrets are Redacted from the read
 * on. Parsers return Either, readers return Effect, and the Settings layer is
 * built from them.
 */
import { FileSystem } from "@effect/platform";
import { Address, AssetId } from "@blaze-cardano/core";
import { resolve } from "path";
import { TOML } from "bun";
import {
  Array as Arr,
  Config,
  ConfigError as ConfigIssue,
  Context,
  Effect,
  Either,
  Layer,
  LogLevel,
  Option,
  Redacted,
} from "effect";
import {
  type Environment,
  environmentOf,
  type PublicNetwork,
} from "./network-mapping";
import { ConfigError, type InputParseError } from "../errors";
import {
  parsePrivateKey,
  parsePrivateKeys,
  parseSigners,
  type PrivateKey,
  type Signers,
} from "../datum/signers";
import {
  parseCandidates,
  type PermissionedCandidate,
} from "../datum/federated-ops";
import {
  bootstrapState,
  type BridgeMaxFee,
  parseActivationBlock,
  parseCommittee,
  parseEpoch,
  parseLovelace,
} from "../datum/bridge";
import type { BeefyConsensusState } from "../../contract_blueprint";
import {
  type Hash32,
  parseAddressOn,
  parseHash32,
  parseTxHash,
  parseTxIndex,
  type TxHash,
  type TxIndex,
  ZERO_HASH32,
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
  "virtual_account_one_shot",
  "rewards_batcher_one_shot",
  "rewards_pool_one_shot",
  "rewards_pool_staging_one_shot",
  "rewards_pool_logic_one_shot",
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

/** Every UTxO the profile names, its one-shots and its collateral, as `txId#index`: coin selection never spends them. */
export const reservedRefs = (config: NetworkConfig): ReadonlySet<string> =>
  new Set(
    ONE_SHOTS.map(
      (name) =>
        `${config[`${name}_hash` as `${OneShot}_hash`]}#${config[`${name}_index` as `${OneShot}_index`]}`,
    ),
  );

/** The governance key groups and their private-key variables. */
const KEY_GROUPS = {
  techAuth: "TECH_AUTH_PRIVATE_KEYS",
  council: "COUNCIL_PRIVATE_KEYS",
} as const;

/** A governance key group. */
export type KeyGroup = keyof typeof KEY_GROUPS;

/** A variable holding the signers a change command installs. */
export type SignersVariable = "COUNCIL_SIGNERS" | "TECH_AUTH_SIGNERS";

/** The aiken.toml profile and the typed environment values of one environment; SettingsLive builds it. */
export class Settings extends Context.Tag("cli/Settings")<
  Settings,
  {
    /** The aiken.toml profile for the environment, read once. */
    readonly profile: Effect.Effect<NetworkConfig, ConfigError>;
    /** DEPLOYER_ADDRESS on the environment's network, or the fixed test address on local/emulator. */
    readonly deployerAddress: Effect.Effect<Address, ConfigError>;
    /** BLOCKFROST_<NETWORK>_API_KEY of a Cardano network. */
    readonly blockfrostApiKey: (
      network: PublicNetwork,
    ) => Effect.Effect<Redacted.Redacted, ConfigError>;
    /** KUPO_URL and OGMIOS_URL. */
    readonly kupmios: Effect.Effect<
      { readonly kupoUrl: string; readonly ogmiosUrl: string },
      ConfigError
    >;
    /** The private keys of a governance group; at least one, each checked. */
    readonly privateKeys: (
      group: KeyGroup,
    ) => Effect.Effect<Arr.NonEmptyReadonlyArray<PrivateKey>, ConfigError>;
    /** The deployer signing key in the variable --signing-key names, checked. */
    readonly signingKey: (
      variable: string,
    ) => Effect.Effect<PrivateKey, ConfigError>;
    /** The signers in COUNCIL_SIGNERS or TECH_AUTH_SIGNERS: the ones deploy installs, or a change command's new set. */
    readonly newSigners: (
      variable: SignersVariable,
    ) => Effect.Effect<Signers, ConfigError | InputParseError>;
    /** PERMISSIONED_CANDIDATES, parsed. */
    readonly permissionedCandidates: Effect.Effect<
      PermissionedCandidate[],
      ConfigError | InputParseError
    >;
    /** The first terms-and-conditions datum: TERMS_AND_CONDITIONS_INITIAL_HASH (zeros when unset) and the hex of TERMS_AND_CONDITIONS_INITIAL_LINK (empty when unset). */
    readonly initialTermsAndConditions: Effect.Effect<
      { readonly hash: Hash32; readonly link: string },
      ConfigError
    >;
    /** The committee bridge's bootstrap state from BRIDGE_ACTIVATION_BLOCK, BRIDGE_MMR_ROOT, BRIDGE_CURRENT_COMMITTEE and BRIDGE_NEXT_COMMITTEE, checked by the forever mint's rules. */
    readonly bridgeBootstrap: Effect.Effect<BeefyConsensusState, ConfigError>;
    /** BRIDGE_MAX_FEE_BASE and BRIDGE_MAX_FEE_PER_SIGNER, in lovelace. */
    readonly bridgeMaxFee: Effect.Effect<BridgeMaxFee, ConfigError>;
    /** REWARDS_FIRST_EPOCH: the first Midnight epoch the rewards batcher loads. */
    readonly rewardsFirstEpoch: Effect.Effect<bigint, ConfigError>;
  }
>() {}

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

/** Read the repository's aiken.toml and parse the environment's profile. */
const readAikenConfig = (
  fs: FileSystem.FileSystem,
  environment: Environment,
): Effect.Effect<NetworkConfig, ConfigError> =>
  Effect.flatMap(
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

const envError = (key: string, reason: string) =>
  new ConfigError({ source: "env", key, reason });

/** A value through the fiber's ConfigProvider, missing or empty as unset; the installed providers fail on a flat key only with missing data, so any other failure is a defect. */
const lookup = <A>(
  config: Config.Config<A>,
  text: (value: A) => string,
): Effect.Effect<Option.Option<A>> =>
  Config.option(config).pipe(
    Effect.map(Option.filter((value) => text(value) !== "")),
    Effect.orDie,
  );

const optionalString = (name: string) =>
  lookup(Config.string(name), (value) => value);

const optionalSecret = (name: string) =>
  lookup(Config.redacted(name), Redacted.value);

const required = <A>(
  name: string,
  value: Effect.Effect<Option.Option<A>>,
): Effect.Effect<A, ConfigError> =>
  Effect.flatMap(
    value,
    Option.match({
      onNone: () => Effect.fail(envError(name, "required but not set")),
      onSome: Effect.succeed,
    }),
  );

const requiredString = (name: string) => required(name, optionalString(name));

const requiredSecret = (name: string) => required(name, optionalSecret(name));

const DEFAULT_LOCAL_DEPLOYER =
  "addr_test1qruhen60uwzpwnnr7gjs50z2v8u9zyfw6zunet4k42zrpr54mrlv55f93rs6j48wt29w90hlxt4rvpvshe55k5r9mpvqjv2wt4";

/** DEPLOYER_ADDRESS parsed on the environment's network, or the fixed test address on local/emulator. */
const readDeployerAddress = (
  environment: Environment,
): Effect.Effect<Address, ConfigError> =>
  Effect.gen(function* () {
    const value = yield* optionalString("DEPLOYER_ADDRESS");
    if (Option.isSome(value)) {
      return yield* Either.mapLeft(
        parseAddressOn(value.value, environment),
        (reason) => envError("DEPLOYER_ADDRESS", reason),
      );
    }
    return environmentOf(environment).local
      ? Address.fromBech32(DEFAULT_LOCAL_DEPLOYER)
      : yield* envError(
          "DEPLOYER_ADDRESS",
          `required for non-local environment '${environment}'`,
        );
  });

/** An env value as a Config, for an option's fallback: unset or empty is `fallback`, anything else goes through `parse`. */
export const envFallback = <A>(
  name: string,
  parse: (text: string) => Either.Either<A, string>,
  fallback: A,
): Config.Config<A> =>
  Config.string(name).pipe(
    Config.withDefault(""),
    Config.mapOrFail((text) =>
      text === ""
        ? Either.right(fallback)
        : Either.mapLeft(parse(text), (reason) =>
            ConfigIssue.InvalidData([name], reason),
          ),
    ),
  );

/** Parse LOG_LEVEL: one of Effect's level labels (case-insensitive); empty means Info. */
export const parseLogLevel = (
  value: string | undefined,
): Either.Either<LogLevel.LogLevel, ConfigError> => {
  if (!value) return Either.right(LogLevel.Info);
  const level = LogLevel.allLevels.find(
    (candidate) => candidate.label.toLowerCase() === value.toLowerCase(),
  );
  return level
    ? Either.right(level)
    : Either.left(
        envError(
          "LOG_LEVEL",
          `'${value}' is not a log level (${LogLevel.allLevels.map((l) => l.label).join(", ")})`,
        ),
      );
};

/** LOG_LEVEL through the fiber's ConfigProvider; unset means Info. */
export const logLevel: Effect.Effect<LogLevel.LogLevel, ConfigError> =
  Effect.flatMap(optionalString("LOG_LEVEL"), (value) =>
    parseLogLevel(Option.getOrUndefined(value)),
  );

/** The variable that holds the Blockfrost API key of a Cardano network. */
export const blockfrostApiKeyVariable = (network: PublicNetwork) =>
  `BLOCKFROST_${network.toUpperCase()}_API_KEY`;

/** A required secret: its comma-separated private keys, at least one, each checked. */
const privateKeys = (name: string) =>
  Effect.flatMap(requiredSecret(name), (secret) =>
    Either.mapLeft(parsePrivateKeys(secret), (reason) =>
      envError(name, reason),
    ),
  );

/** A required value through its parser; the error names the variable. */
const parsed = <A>(
  name: string,
  parse: (text: string) => Either.Either<A, string>,
) =>
  Effect.flatMap(requiredString(name), (text) =>
    Either.mapLeft(parse(text.trim()), (reason) => envError(name, reason)),
  );

/** A required secret holding one private key, checked. */
const privateKey = (name: string) =>
  Effect.flatMap(requiredSecret(name), (secret) =>
    Either.mapLeft(parsePrivateKey(Redacted.value(secret).trim()), (reason) =>
      envError(name, reason),
    ),
  );

/** Settings for one environment; aiken.toml is read through FileSystem on first use, environment values through the fiber's ConfigProvider when asked. */
export const SettingsLive = (
  environment: Environment,
): Layer.Layer<Settings, never, FileSystem.FileSystem> =>
  Layer.effect(
    Settings,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return {
        profile: yield* Effect.cached(readAikenConfig(fs, environment)),
        deployerAddress: readDeployerAddress(environment),
        blockfrostApiKey: (network: PublicNetwork) =>
          requiredSecret(blockfrostApiKeyVariable(network)),
        kupmios: Effect.all({
          kupoUrl: requiredString("KUPO_URL"),
          ogmiosUrl: requiredString("OGMIOS_URL"),
        }),
        privateKeys: (group: KeyGroup) => privateKeys(KEY_GROUPS[group]),
        signingKey: privateKey,
        newSigners: (variable: SignersVariable) =>
          Effect.flatMap(requiredString(variable), (value) =>
            parseSigners(variable, value),
          ),
        permissionedCandidates: Effect.flatMap(
          requiredString("PERMISSIONED_CANDIDATES"),
          parseCandidates,
        ),
        initialTermsAndConditions: Effect.all({
          hash: Effect.flatMap(
            optionalString("TERMS_AND_CONDITIONS_INITIAL_HASH"),
            Option.match({
              onNone: () => Effect.succeed(ZERO_HASH32),
              onSome: (text) =>
                Either.mapLeft(parseHash32(text), (reason) =>
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
        }),
        bridgeBootstrap: Effect.flatMap(
          Effect.all({
            activationBlock: parsed(
              "BRIDGE_ACTIVATION_BLOCK",
              parseActivationBlock,
            ),
            mmrRoot: parsed("BRIDGE_MMR_ROOT", parseHash32),
            current: parsed("BRIDGE_CURRENT_COMMITTEE", parseCommittee),
            next: parsed("BRIDGE_NEXT_COMMITTEE", parseCommittee),
          }),
          (values) =>
            Either.mapLeft(bootstrapState(values), (reason) =>
              envError("BRIDGE_NEXT_COMMITTEE", reason),
            ),
        ),
        bridgeMaxFee: Effect.all({
          base: parsed("BRIDGE_MAX_FEE_BASE", parseLovelace),
          perSigner: parsed("BRIDGE_MAX_FEE_PER_SIGNER", parseLovelace),
        }),
        rewardsFirstEpoch: parsed("REWARDS_FIRST_EPOCH", parseEpoch),
      };
    }),
  );

/** The cNIGHT asset of a profile: cnight_policy plus the UTF-8 cnight_name. */
export const cnightAssetId = (config: NetworkConfig): AssetId =>
  AssetId(
    config.cnight_policy + Buffer.from(config.cnight_name).toString("hex"),
  );

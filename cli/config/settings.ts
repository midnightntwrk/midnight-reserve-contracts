/**
 * Configuration: the Settings service over Profile, DeployerAddress,
 * ProviderConfig, Keys and the intent values, and the free env readers
 * (envFallback, LOG_LEVEL). Environment values come through the fiber's
 * ConfigProvider (the process environment with .env as a fallback in the
 * CLI, a literal map in tests).
 */
import type { FileSystem } from "@effect/platform";
import type { Address } from "@blaze-cardano/core";
import {
  type Array as Arr,
  Config,
  ConfigError as ConfigIssue,
  Context,
  Effect,
  Either,
  Layer,
  LogLevel,
  Option,
  type Redacted,
} from "effect";
import type { Environment, PublicNetwork } from "./network-mapping";
import type { ConfigError, InputParseError } from "../errors";
import type { PrivateKey, Signers } from "../datum/signers";
import type { PermissionedCandidate } from "../datum/federated-ops";
import type { Hash32 } from "../input";
import { envError, optionalString } from "./env";
import { type NetworkConfig, Profile, ProfileLive } from "./profile";
import { DeployerAddress, DeployerAddressLive } from "./deployer";
import { ProviderConfig, ProviderConfigLive } from "./provider-config";
import { type KeyGroup, Keys, KeysLive } from "./keys";
import {
  initialTermsAndConditions,
  newSigners,
  permissionedCandidates,
  type SignersVariable,
} from "./intent-env";

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
  }
>() {}

/** The configuration services of one environment: its Profile, DeployerAddress, ProviderConfig and Keys. */
export const ConfigLive = (environment: Environment) =>
  Layer.mergeAll(
    ProfileLive(environment),
    DeployerAddressLive(environment),
    ProviderConfigLive,
    KeysLive,
  );

/** Settings for one environment over its configuration services, which the layer also provides. */
export const SettingsLive = (environment: Environment) =>
  Layer.provideMerge(
    Layer.effect(
      Settings,
      Effect.gen(function* () {
        const profile = yield* Profile;
        const deployer = yield* DeployerAddress;
        const provider = yield* ProviderConfig;
        const keys = yield* Keys;
        return {
          profile: profile.config,
          deployerAddress: deployer.address,
          blockfrostApiKey: provider.blockfrostApiKey,
          kupmios: provider.kupmios,
          privateKeys: keys.privateKeys,
          signingKey: keys.signingKey,
          newSigners,
          permissionedCandidates,
          initialTermsAndConditions,
        };
      }),
    ),
    ConfigLive(environment),
  ) satisfies Layer.Layer<
    Settings | Profile | DeployerAddress | ProviderConfig | Keys,
    never,
    FileSystem.FileSystem
  >;

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

/** Parse LOG_LEVEL: an Effect level label (WARN, OFF) or name (Warning, None), as `--log-level` takes it, case-insensitive; empty means Info. */
export const parseLogLevel = (
  value: string | undefined,
): Either.Either<LogLevel.LogLevel, ConfigError> => {
  if (!value) return Either.right(LogLevel.Info);
  const wanted = value.toLowerCase();
  const level = LogLevel.allLevels.find(
    (candidate) =>
      candidate.label.toLowerCase() === wanted ||
      candidate._tag.toLowerCase() === wanted,
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

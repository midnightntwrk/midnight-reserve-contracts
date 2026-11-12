/**
 * Environment values through the fiber's ConfigProvider (the process
 * environment with .env as a fallback in the CLI, a literal map in tests).
 * Missing and empty both read as unset; secrets are Redacted from the read
 * on; a bad or missing value is a ConfigError naming its variable. Also the
 * option fallbacks (envFallback) and LOG_LEVEL.
 */
import {
  Config,
  ConfigError as ConfigIssue,
  Effect,
  Either,
  LogLevel,
  Option,
  Redacted,
} from "effect";
import { ConfigError } from "../errors";

export const envError = (key: string, reason: string) =>
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

export const optionalString = (name: string) =>
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

export const requiredString = (name: string) =>
  required(name, optionalString(name));

export const requiredSecret = (name: string) =>
  required(name, optionalSecret(name));

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

/**
 * Environment values through the fiber's ConfigProvider (the process
 * environment with .env as a fallback in the CLI, a literal map in tests).
 * Missing and empty both read as unset; secrets are Redacted from the read
 * on; a bad or missing value is a ConfigError naming its variable.
 */
import { Config, Effect, Option, Redacted } from "effect";
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

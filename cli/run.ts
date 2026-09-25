/** The CLI's runtime edge: the root layer, the services a command runs on, the failure report and the teardown. */
import { Command, ValidationError } from "@effect/cli";
import {
  FetchHttpClient,
  type HttpClient,
  PlatformConfigProvider,
  type Runtime,
} from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import {
  Cause,
  Console,
  Effect,
  Exit,
  Layer,
  Logger,
  type LogLevel,
  Option,
} from "effect";
import type { ProviderType } from "./config/network-mapping";
import type { NetworkInput } from "./input";
import { type Settings, SettingsLive, logLevel } from "./config/settings";
import {
  type Blueprint,
  BlueprintLive,
  type BlueprintSource,
  hasDeployedScripts,
} from "./contracts/contracts";
import { Output, OutputLive } from "./output";
import {
  type DeployedScripts,
  DeployedScriptsLive,
} from "./contracts/versions";
import { BlueprintError, renderError, type CliError } from "./errors";
import { type Provider, ProviderLive } from "./chain/provider";

/** Everything a command program may require: the CLI services and the platform (FileSystem, Path, CommandExecutor, Terminal, HttpClient). */
export type CliServices =
  | Settings
  | Blueprint
  | Provider
  | Output
  | DeployedScripts
  | BunContext.BunContext
  | HttpClient.HttpClient;

/** Logs on stderr, pretty on a TTY and logfmt otherwise, from `level` up. */
export const LoggingLive = (level: LogLevel.LogLevel, tty: boolean) =>
  Layer.mergeAll(
    Logger.replace(
      Logger.defaultLogger,
      tty
        ? Logger.prettyLogger({ stderr: true })
        : Logger.withConsoleError(Logger.logfmtLogger),
    ),
    Logger.minimumLogLevel(level),
  );

/** `path` (a dotenv file) as the fallback under the current ConfigProvider; a missing file adds nothing. */
export const DotEnvFallback = (path: string) =>
  Layer.provide(PlatformConfigProvider.layerDotEnvAdd(path), BunContext.layer);

/** LoggingLive at LOG_LEVEL, read through the current ConfigProvider. */
const LoggingFromEnv = Layer.unwrapEffect(
  Effect.map(logLevel, (level) =>
    LoggingLive(level, process.stderr.isTTY === true),
  ),
);

/** The Bun platform, the fetch HttpClient, Output (what the failure report needs) and the repository's deployed-scripts/; building it cannot fail. */
export const BaseLive = Layer.mergeAll(
  Layer.provideMerge(
    OutputLive,
    Layer.mergeAll(BunContext.layer, FetchHttpClient.layer),
  ),
  DeployedScriptsLive,
);

/** Logging at LOG_LEVEL over the process environment with .env as the fallback; a bad LOG_LEVEL fails it, inside the report. */
export const EnvLive = Layer.provideMerge(
  LoggingFromEnv,
  DotEnvFallback(".env"),
);

/** Print a failed run once: a CliError through Output, the defects as Cause.pretty, an interrupt alone as its line; @effect/cli has printed a ValidationError. */
export const reportFailure = (
  cause: Cause.Cause<CliError | ValidationError.ValidationError>,
) =>
  Effect.gen(function* () {
    const failure = Cause.failureOption(cause);
    if (
      Option.isSome(failure) &&
      !ValidationError.isValidationError(failure.value)
    ) {
      const output = yield* Output;
      yield* output.error(renderError(failure.value));
    }
    if (Cause.isDie(cause)) {
      yield* Console.error(Cause.pretty(Cause.stripFailures(cause)));
    } else if (Cause.isInterruptedOnly(cause)) {
      yield* Console.error(Cause.pretty(cause));
    }
  });

/** Code 1 on any failure, an interrupt included, which runMain exits with; on success the process ends when its event loop empties (the one socket, Ogmios, closes with the Provider layer). */
export const teardown: Runtime.Teardown = (exit, onExit) =>
  onExit(Exit.isSuccess(exit) ? 0 : 1);

/** A command's environment and --provider. */
interface ProviderInput extends NetworkInput {
  readonly provider: Option.Option<ProviderType>;
}

/** A command's --use-build. */
interface UseBuildInput {
  readonly useBuild: boolean;
}

/** The blueprint --use-build selects; without it, an environment with no deployed scripts is refused here, where the flag is the remedy. */
const useBuildSource = (
  input: NetworkInput & UseBuildInput,
): Effect.Effect<BlueprintSource, BlueprintError> =>
  input.useBuild
    ? Effect.succeed("build")
    : hasDeployedScripts(input.network)
      ? Effect.succeed("deployed")
      : Effect.fail(
          new BlueprintError({
            environment: input.network,
            source: "deployed",
            reason:
              "the environment has no deployed scripts; pass --use-build to load the build output",
          }),
        );

/** Settings and the provider of a command's environment. */
const ChainLive = (input: ProviderInput) => {
  const settings = SettingsLive(input.network);
  return Layer.merge(
    settings,
    Layer.provide(
      ProviderLive(input.network, Option.getOrUndefined(input.provider)),
      settings,
    ),
  );
};

/** Settings, the blueprint and the provider of a command's environment. */
const ServicesLive = (input: ProviderInput, source: BlueprintSource) =>
  Layer.merge(ChainLive(input), BlueprintLive(input.network, source));

/** Run a command's program on the Settings and the provider of its parsed environment, with no blueprint. */
export const withProvider = <
  Name extends string,
  R,
  E,
  A extends ProviderInput,
>(
  command: Command.Command<Name, R, E, A>,
) => Command.provide(command, ChainLive);

/** Run a command's program on the services of its parsed environment, over the given blueprint. */
export const withServices =
  (source: BlueprintSource) =>
  <Name extends string, R, E, A extends ProviderInput>(
    command: Command.Command<Name, R, E, A>,
  ) =>
    Command.provide(command, (input) => ServicesLive(input, source));

/** Run a command's program on the services of its parsed environment, over the blueprint --use-build selects. */
export const withServicesUseBuild = <
  Name extends string,
  R,
  E,
  A extends ProviderInput & UseBuildInput,
>(
  command: Command.Command<Name, R, E, A>,
) =>
  Command.provide(command, (input) =>
    Layer.unwrapEffect(
      Effect.map(useBuildSource(input), (source) =>
        ServicesLive(input, source),
      ),
    ),
  );

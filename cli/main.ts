#!/usr/bin/env vpx
/**
 * The CLI's runtime edge: argv through the command tree, the layers a
 * command runs on, the failure report and the exit code.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Console, Effect, Exit, Layer, Option } from "effect";
import { Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import packageJson from "../package.json" with { type: "json" };
import { commands } from "./commands";
import { DeployedScripts, envLayer, loggingLayer } from "./config";
import { isCliError, renderError } from "./errors";
import { Keys } from "./keys";
import { Output } from "./output";

const root = Command.make("midnight-reserve").pipe(
  Command.withSubcommands(commands),
);

// runMain interrupts on SIGINT and SIGTERM only; a closed terminal (SIGHUP) interrupts too, which stops a running aiken.
process.once("SIGHUP", () => process.kill(process.pid, "SIGTERM"));

Command.run(root, { version: packageJson.version }).pipe(
  // The root alone has printed its help, which is not a failure; a parse error has printed its help with the error.
  Effect.catchTag("ShowHelp", (error) =>
    error.errors.length === 0 ? Effect.void : Effect.fail(error),
  ),
  // The platform, the process environment with .env as the fallback, and the logging it sets (LOG_LEVEL, logs on stderr). Inside the failure report, so a bad LOG_LEVEL is reported.
  Effect.provide(
    Layer.provideMerge(
      loggingLayer,
      Layer.provideMerge(envLayer(".env"), NodeServices.layer),
    ),
  ),
  // Report a failure once: a CliError through Output, the defects as Cause.pretty, an interrupt alone as its line.
  Effect.tapCause((cause) =>
    Effect.gen(function* () {
      const failure = Cause.findErrorOption(cause);
      if (Option.isSome(failure) && isCliError(failure.value)) {
        const output = yield* Output;
        yield* output.error(renderError(failure.value));
      }
      if (Cause.hasDies(cause)) {
        yield* Console.error(
          Cause.pretty(
            Cause.fromReasons(cause.reasons.filter(Cause.isDieReason)),
          ),
        );
      } else if (Cause.hasInterruptsOnly(cause)) {
        yield* Console.error(Cause.pretty(cause));
      }
    }),
  ),
  Effect.provide(
    Layer.mergeAll(
      FetchHttpClient.layer,
      Keys.layer,
      Output.layer,
      DeployedScripts.layer,
    ),
  ),
  // Exit code 1 on any failure, an interrupt included.
  NodeRuntime.runMain({
    disableErrorReporting: true,
    teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) ? 0 : 1),
  }),
);

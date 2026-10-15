#!/usr/bin/env bun

import { Command } from "@effect/cli";
import { BunRuntime } from "@effect/platform-bun";
import { initCrypto } from "@blaze-cardano/core";
import { Console, Effect, Exit, Option } from "effect";
import { commands } from "./commands";
import { BaseLive, EnvLive, reportFailure, teardown } from "./run";
import { helpFor } from "./help";
import packageJson from "../package.json";

const NAME = "midnight-reserve";

const root = Command.make(NAME).pipe(Command.withSubcommands(commands));

const cli = Command.run(root, {
  name: NAME,
  version: packageJson.version,
});

/* eslint-disable no-console -- Blaze writes this warning straight to console.warn. */
// Blaze warns whenever a transaction sets a fee floor or padding; --fee-padding and a funded bridge update set them on purpose.
const BLAZE_FEE_WARNING = "A transaction was built using fee padding.";
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (!(typeof args[0] === "string" && args[0].startsWith(BLAZE_FEE_WARNING)))
    warn(...args);
};
/* eslint-enable no-console */

// Extended keys sign through libsodium, which loads asynchronously.
await initCrypto();

// runMain interrupts on SIGINT and SIGTERM only.
process.once("SIGHUP", () => process.kill(process.pid, "SIGTERM"));

const program = Option.match(
  helpFor(root, NAME, packageJson.version, process.argv.slice(2)),
  {
    onSome: Console.log,
    onNone: () =>
      cli(process.argv).pipe(
        Effect.provide(EnvLive),
        Effect.onExit(
          Exit.match({
            onFailure: reportFailure,
            onSuccess: () => Effect.void,
          }),
        ),
      ),
  },
);

program.pipe(
  Effect.provide(BaseLive),
  BunRuntime.runMain({
    disableErrorReporting: true,
    disablePrettyLogger: true,
    teardown,
  }),
);

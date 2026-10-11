/** TypeScript blueprint generation from a plutus.json, through the installed generator. */
import { resolve } from "path";
import { Command, type CommandExecutor } from "@effect/platform";
import { Effect } from "effect";
import { BlueprintError } from "../errors";
import { PROJECT_ROOT } from "./paths";

/** The installed blueprint generator; bun runs it, so no registry is reached. */
const BLUEPRINT_CLI = resolve(PROJECT_ROOT, "node_modules/.bin/blueprint");

/** Generate the TypeScript blueprint of a plutus.json; the generator's stderr reaches the user, its one-line stdout does not. */
export const generateBlueprint = (
  env: string,
  source: "deployed" | "build",
  plutusPath: string,
  outputPath: string,
): Effect.Effect<void, BlueprintError, CommandExecutor.CommandExecutor> => {
  const failure = (reason: string) =>
    new BlueprintError({ environment: env, source, reason });
  return Effect.flatMap(
    Effect.mapError(
      Command.make(
        process.execPath,
        BLUEPRINT_CLI,
        plutusPath,
        "-o",
        outputPath,
      ).pipe(Command.stderr("inherit"), Command.exitCode),
      (cause) => failure(`blueprint generation failed: ${cause.message}`),
    ),
    (exitCode) =>
      exitCode === 0
        ? Effect.void
        : Effect.fail(
            failure(`blueprint generation failed with exit code ${exitCode}`),
          ),
  );
};

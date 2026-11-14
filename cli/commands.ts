/** Every command: its flags, parsed at the boundary, and the program it runs. */
import { Effect, Result } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import { ENVIRONMENTS, PROFILES } from "./config";
import { buildProgram, TRACE_LEVELS } from "./contracts/build";
import { DEPLOY_COMPONENTS } from "./contracts/resolver";
import { parseNameList } from "./input";
import { generateKeyProgram } from "./wallet";

const generateKey = Command.make(
  "generate-key",
  {
    network: Flag.Literals("network", ENVIRONMENTS).pipe(
      Flag.withAlias("n"),
      Flag.withDescription("The environment (default: local)"),
      Flag.withDefault("local"),
    ),
  },
  generateKeyProgram,
).pipe(
  Command.withDescription("Generate a new signing key and Cardano address"),
);

const build = Command.make(
  "build",
  {
    network: Flag.Literals("network", PROFILES).pipe(
      Flag.withAlias("n"),
      Flag.withDescription("The aiken.toml profile (default: default)"),
      Flag.withDefault("default"),
    ),
    trace: Flag.Literals("trace", TRACE_LEVELS).pipe(
      Flag.withDescription("Aiken trace level (default: verbose)"),
      Flag.withDefault("verbose"),
    ),
    fromDeployed: Flag.Boolean("from-deployed").pipe(
      Flag.withDescription(
        "Compile against the hashes in deployed-scripts/<env>/plutus.json",
      ),
      Flag.withDefault(false),
    ),
    components: Flag.String("components").pipe(
      Flag.withDescription(
        "With --from-deployed: components to compile from new, named as in deploy --components",
      ),
      Flag.mapEffect((text) =>
        Result.match(parseNameList(DEPLOY_COMPONENTS)(text), {
          onFailure: (expected) =>
            Effect.fail(
              new CliError.InvalidValue({
                option: "components",
                value: text,
                expected,
                kind: "flag",
              }),
            ),
          onSuccess: Effect.succeed,
        }),
      ),
      Flag.optional,
    ),
  },
  buildProgram,
).pipe(
  Command.withDescription(
    "Compile Aiken contracts and generate TypeScript bindings",
  ),
);

/** Every command, in the order `--help` lists them. */
export const commands = [generateKey, build] as const;

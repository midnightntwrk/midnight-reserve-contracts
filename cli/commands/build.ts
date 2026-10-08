import { Command, HelpDoc, Options, ValidationError } from "@effect/cli";
import { Effect, Option } from "effect";
import { parsedText, profile } from "../options";
import { parseNameList } from "../input";
import { type BuildSource, TRACE_LEVELS } from "../contracts/build-engine";
import { buildProgram } from "../contracts/build";
import {
  DEPLOY_COMPONENT_VALIDATORS,
  DEPLOY_COMPONENTS,
} from "../deploy/deploy";

const trace = Options.choice("trace", TRACE_LEVELS).pipe(
  Options.withDescription("Aiken trace level (default: verbose)"),
  Options.withDefault("verbose"),
);

const fromDeployed = Options.boolean("from-deployed").pipe(
  Options.withDescription(
    "Compile against the hashes in deployed-scripts/<env>/plutus.json",
  ),
);

const components = parsedText(
  "components",
  parseNameList(DEPLOY_COMPONENTS),
).pipe(
  Options.withDescription(
    "With --from-deployed: components to compile from new, named as in deploy --components",
  ),
  Options.optional,
);

/** --from-deployed and --components as one source; --components alone is refused. */
const source = Options.all({ fromDeployed, components }).pipe(
  Options.mapEffect(
    ({
      fromDeployed,
      components,
    }): Effect.Effect<BuildSource, ValidationError.ValidationError> =>
      fromDeployed
        ? Effect.succeed({
            kind: "fromDeployed",
            fresh: new Set(
              Option.match(components, {
                onNone: () => [],
                onSome: (names) =>
                  names.flatMap((name) => DEPLOY_COMPONENT_VALIDATORS[name]),
              }),
            ),
          })
        : Option.isSome(components)
          ? Effect.fail(
              ValidationError.invalidValue(
                HelpDoc.p("Invalid --components: it needs --from-deployed"),
              ),
            )
          : Effect.succeed({ kind: "standard" }),
  ),
);

export const build = Command.make(
  "build",
  { network: profile, trace, source },
  buildProgram,
).pipe(
  Command.withDescription(
    "Compile Aiken contracts and generate TypeScript bindings",
  ),
);

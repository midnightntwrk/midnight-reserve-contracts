/** Every command: its flags, parsed at the boundary, and the program it runs. */
import { Effect, Layer, Option, Result } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { Provider, PROVIDERS, type ProviderType } from "./chain";
import { type Environment, ENVIRONMENTS, PROFILES } from "./config";
import { buildProgram, TRACE_LEVELS } from "./contracts/build";
import { ContractResolver, DEPLOY_COMPONENTS } from "./contracts/resolver";
import { parseNameList } from "./input";
import {
  dustParticipantsProgram,
  FORMATS,
  INFO_COMPONENT_CHOICES,
  infoProgram,
  verifyProgram,
} from "./report";
import { combineSignaturesProgram, signAndSubmitProgram } from "./signing";
import { generateKeyProgram } from "./wallet";

const network = Flag.Literals("network", ENVIRONMENTS).pipe(
  Flag.withAlias("n"),
  Flag.withDescription("The environment (default: local)"),
  Flag.withDefault("local"),
);

const provider = Flag.Literals("provider", PROVIDERS).pipe(
  Flag.withAlias("p"),
  Flag.withDescription("The chain provider (default: the environment's)"),
  Flag.optional,
);

/** Run a command on the Provider of its --network and --provider. */
const withProvider = <
  const Name extends string,
  Input extends {
    readonly network: Environment;
    readonly provider: Option.Option<ProviderType>;
  },
  ContextInput,
  E,
  R,
>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
) =>
  Command.provide(command, (input: Input) =>
    Provider.layer(input.network, Option.getOrUndefined(input.provider)),
  );

/** Run a command on the Provider and the ContractResolver of its --network and --provider. */
const withServices = <
  const Name extends string,
  Input extends {
    readonly network: Environment;
    readonly provider: Option.Option<ProviderType>;
  },
  ContextInput,
  E,
  R,
>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
) =>
  Command.provide(command, (input: Input) =>
    Layer.merge(
      Provider.layer(input.network, Option.getOrUndefined(input.provider)),
      ContractResolver.layer(input.network),
    ),
  );

const format = Flag.Literals("format", FORMATS).pipe(
  Flag.withDescription("Output format (default: table)"),
  Flag.withDefault("table"),
);

/** --signing-key and --no-sign-deployer: the deployer's signature at submit. */
const deployerSigning = {
  signingKey: Flag.String("signing-key").pipe(
    Flag.withDescription(
      "Environment variable with the deployer key (default: SIGNING_PRIVATE_KEY)",
    ),
    Flag.withDefault("SIGNING_PRIVATE_KEY"),
  ),
  signDeployer: Flag.Boolean("no-sign-deployer").pipe(
    Flag.withDescription("Do not sign with the deployer key"),
    Flag.withDefault(false),
    Flag.map((unsigned) => !unsigned),
  ),
};

const generateKey = Command.make(
  "generate-key",
  { network },
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

const signAndSubmit = Command.make(
  "sign-and-submit",
  {
    network,
    provider,
    ...deployerSigning,
    jsonFile: Argument.String("json-file").pipe(
      Argument.withDescription(
        "Path to the JSON file containing transaction(s)",
      ),
    ),
  },
  signAndSubmitProgram,
).pipe(
  Command.withDescription("Sign and submit transactions from a JSON file"),
  withProvider,
);

const combineSignatures = Command.make(
  "combine-signatures",
  {
    network,
    provider,
    ...deployerSigning,
    tx: Flag.String("tx").pipe(
      Flag.withDescription("Transaction file that holds one transaction"),
    ),
    witnessFiles: Argument.String("witness-file").pipe(
      Argument.withDescription(
        "Witness files: cardano-cli key witnesses or CIP-30 witness sets",
      ),
      Argument.atLeast(1),
    ),
  },
  combineSignaturesProgram,
).pipe(
  Command.withDescription(
    "Combine wallet signatures into a single transaction and submit",
  ),
  withProvider,
);

const info = Command.make(
  "info",
  {
    network,
    provider,
    useBuild: Flag.Boolean("use-build").pipe(
      Flag.withDescription("Use build output instead of deployed blueprint"),
      Flag.withDefault(false),
    ),
    format,
    component: Flag.Literals("component", INFO_COMPONENT_CHOICES).pipe(
      Flag.withDescription("Filter by component (default: all)"),
      Flag.withDefault("all"),
    ),
    save: Flag.Boolean("save").pipe(
      Flag.withDescription(
        "Fetch on-chain data and save the report to the release directory",
      ),
      Flag.withDefault(false),
    ),
    releaseDir: Flag.String("release-dir").pipe(
      Flag.withDescription(
        "Base directory for --save output (default: ./release)",
      ),
      Flag.withDefault("./release"),
    ),
  },
  infoProgram,
).pipe(Command.withDescription("Display contract information"), withServices);

const verify = Command.make(
  "verify",
  { network, provider },
  verifyProgram,
).pipe(
  Command.withDescription("Verify the deployed record against the chain"),
  withServices,
);

const dustParticipants = Command.make(
  "dust-participants",
  { network, provider, format },
  dustParticipantsProgram,
).pipe(
  Command.withDescription("Count registered dust participants"),
  withServices,
);

/** Every command, in the order `--help` lists them. */
export const commands = [
  info,
  verify,
  generateKey,
  signAndSubmit,
  combineSignatures,
  dustParticipants,
  build,
] as const;

/** Every command: its flags, parsed at the boundary, and the program it runs. */
import { Effect, Layer, Option, Result } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { Provider, PROVIDERS, type ProviderType } from "./chain";
import {
  DeployerAddress,
  type Environment,
  ENVIRONMENTS,
  Profile,
  PROFILES,
} from "./config";
import { buildProgram, TRACE_LEVELS } from "./contracts/build";
import { ContractResolver, DEPLOY_COMPONENTS } from "./contracts/resolver";
import {
  federatedOpsChangeProgram,
  termsChangeProgram,
} from "./governance/forever";
import { multisigChangeProgram } from "./governance/multisig";
import {
  parseBech32Address,
  parseKeyAddress,
  parseNameList,
  parseHash32,
  parseNonNegativeInteger,
  parsePositiveBigInt,
  parsePositiveInteger,
  parseTxHash,
  parseTxIndex,
} from "./input";
import {
  dustParticipantsProgram,
  FORMATS,
  INFO_COMPONENT_CHOICES,
  infoProgram,
  verifyProgram,
} from "./report";
import { combineSignaturesProgram, signAndSubmitProgram } from "./signing";
import {
  generateKeyProgram,
  mergeUtxosProgram,
  mintTcnightProgram,
  simpleTxProgram,
} from "./wallet";

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
    Layer.mergeAll(
      Provider.layer(input.network, Option.getOrUndefined(input.provider)),
      ContractResolver.layer(input.network),
      Profile.layer(input.network),
      DeployerAddress.layer(input.network),
    ),
  );

/** A flag whose text `parse` turns into its value; a refused text is an invalid value naming the reason. */
const parsed = <A>(
  name: string,
  parse: (text: string) => Effect.Effect<A, string>,
) =>
  Flag.String(name).pipe(
    Flag.mapEffect((text) =>
      Effect.mapError(
        parse(text),
        (expected) =>
          new CliError.InvalidValue({
            option: name,
            value: text,
            expected,
            kind: "flag",
          }),
      ),
    ),
  );

/** -o/--output: the directory the environment's files go under. */
const outputDir = Flag.String("output").pipe(
  Flag.withAlias("o"),
  Flag.withDescription("Output directory (default: ./deployments)"),
  Flag.withDefault("./deployments"),
);

/** --output-file: the transaction file's name. */
const outputFile = (fallback: string) =>
  Flag.String("output-file").pipe(
    Flag.withDescription(`Output file name (default: ${fallback})`),
    Flag.withDefault(fallback),
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

const simpleTx = Command.make(
  "simple-tx",
  {
    network,
    provider,
    outputDir,
    count: parsed("count", (text) =>
      Effect.fromResult(parsePositiveInteger(text)),
    ).pipe(
      Flag.withAlias("c"),
      Flag.withDescription(
        "Number of outputs to create (default: SIMPLE_TX_COUNT, else 16)",
      ),
      Flag.optional,
    ),
    amount: parsed("amount", (text) =>
      Effect.fromResult(parsePositiveBigInt(text)),
    ).pipe(
      Flag.withDescription(
        "Lovelace per output (default: SIMPLE_TX_AMOUNT, else 20 ADA)",
      ),
      Flag.optional,
    ),
    to: parsed("to", parseKeyAddress).pipe(
      Flag.withDescription(
        "Recipient key address, not a script (default: DEPLOYER_ADDRESS)",
      ),
      Flag.optional,
    ),
    outputFile: outputFile("simple-tx.json"),
  },
  simpleTxProgram,
).pipe(
  Command.withDescription("Create simple transactions for testing"),
  withServices,
);

const mintTcnight = Command.make(
  "mint-tcnight",
  {
    network: network.pipe(
      Flag.withDescription(
        "The test environment (default: local; mainnet is refused)",
      ),
      Flag.mapEffect((environment) =>
        environment === "mainnet"
          ? Effect.fail(
              new CliError.InvalidValue({
                option: "network",
                value: environment,
                expected:
                  "a test environment; mainnet is refused, this command runs only on a test environment",
                kind: "flag",
              }),
            )
          : Effect.succeed(environment),
      ),
    ),
    provider,
    outputDir,
    amount: parsed("amount", (text) =>
      Effect.fromResult(parsePositiveBigInt(text)),
    ).pipe(Flag.withDescription("Amount of NIGHT tokens to mint or burn")),
    userAddress: parsed("user-address", parseBech32Address).pipe(
      Flag.withAlias("u"),
      Flag.withDescription("User address (wallet for signing and burn source)"),
    ),
    destination: parsed("destination", parseBech32Address).pipe(
      Flag.withAlias("d"),
      Flag.withDescription(
        "Destination address, mint only (default: user address)",
      ),
      Flag.optional,
    ),
    burn: Flag.Boolean("burn").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Burn tokens instead of minting"),
      Flag.withDefault(false),
    ),
    outputFile: outputFile("mint-tcnight-tx.json"),
  },
  mintTcnightProgram,
).pipe(
  Command.withDescription("Mint or burn TCnight tokens (non-mainnet only)"),
  withServices,
);

const txHashFlag = (name: string, description: string) =>
  parsed(name, (text) => Effect.fromResult(parseTxHash(text))).pipe(
    Flag.withDescription(description),
  );

const txIndexFlag = (name: string, description: string) =>
  parsed(name, (text) => Effect.fromResult(parseTxIndex(text))).pipe(
    Flag.withDescription(description),
  );

/** --tx-hash, --tx-index and --fee-padding: the deployer UTxO that pays the fee. */
const feeUtxo = {
  txHash: txHashFlag("tx-hash", "Transaction hash for the fee-paying UTxO"),
  txIndex: txIndexFlag("tx-index", "Transaction index for the fee-paying UTxO"),
  feePadding: parsed("fee-padding", (text) =>
    Effect.fromResult(
      Result.map(parseNonNegativeInteger(text), (n) => BigInt(n)),
    ),
  ).pipe(
    Flag.withDescription(
      "Fee padding in lovelace, 0 or greater (default: 50000)",
    ),
    Flag.withDefault(50_000n),
  ),
};

/** A governance transaction's flags in help order: --network, --provider, -o/--output, the fee UTxO, `afterFee`, --no-sign (both authorities) and --output-file <name>-tx.json. */
const governanceTxFlags = <
  AfterFee extends Record<string, Flag.Flag<unknown>> = Record<never, never>,
>(
  name: string,
  afterFee = {} as AfterFee,
) => ({
  network,
  provider,
  outputDir,
  ...feeUtxo,
  ...afterFee,
  sign: Flag.Boolean("no-sign").pipe(
    Flag.withDescription(
      "Leave the transaction unsigned (signing reads TECH_AUTH_PRIVATE_KEYS and COUNCIL_PRIVATE_KEYS)",
    ),
    Flag.withDefault(false),
    Flag.map((unsigned) => !unsigned),
  ),
  outputFile: outputFile(`${name}-tx.json`),
});

const changeCouncil = Command.make(
  "change-council",
  governanceTxFlags("change-council"),
  (input) => multisigChangeProgram("council", input),
).pipe(
  Command.withDescription("Update council multisig members"),
  withServices,
);

const changeTechAuth = Command.make(
  "change-tech-auth",
  governanceTxFlags("change-tech-auth"),
  (input) => multisigChangeProgram("tech-auth", input),
).pipe(
  Command.withDescription("Update tech auth multisig members"),
  withServices,
);

const changeFederatedOps = Command.make(
  "change-federated-ops",
  governanceTxFlags("change-federated-ops"),
  federatedOpsChangeProgram,
).pipe(Command.withDescription("Update federated ops members"), withServices);

const changeTerms = Command.make(
  "change-terms",
  governanceTxFlags("change-terms", {
    hash: parsed("hash", (text) => Effect.fromResult(parseHash32(text))).pipe(
      Flag.withDescription(
        "New terms and conditions hash (64 hex chars, 32 bytes SHA-256)",
      ),
    ),
    url: Flag.String("url").pipe(
      Flag.withDescription("New terms and conditions URL (plain text)"),
    ),
  }),
  termsChangeProgram,
).pipe(
  Command.withDescription("Change terms and conditions hash and URL"),
  withServices,
);

const mergeUtxos = Command.make(
  "merge-utxos",
  {
    network,
    provider,
    outputDir,
    validator: Flag.Literals("validator", ["reserve", "ics"]).pipe(
      Flag.withDescription("Forever validator family: reserve or ics"),
    ),
    utxo1Hash: txHashFlag(
      "utxo1-hash",
      "Transaction hash of the first UTxO to merge",
    ),
    utxo1Index: txIndexFlag(
      "utxo1-index",
      "Output index of the first UTxO to merge",
    ),
    utxo2Hash: txHashFlag(
      "utxo2-hash",
      "Transaction hash of the second UTxO to merge",
    ),
    utxo2Index: txIndexFlag(
      "utxo2-index",
      "Output index of the second UTxO to merge",
    ),
    ...feeUtxo,
    outputFile: outputFile("merge-utxos-tx.json"),
  },
  mergeUtxosProgram,
).pipe(
  Command.withDescription(
    "Merge two value-holding UTxOs at a forever validator into one",
  ),
  withServices,
);

/** Every command, in the order `--help` lists them. */
export const commands = [
  changeCouncil,
  changeTechAuth,
  changeFederatedOps,
  simpleTx,
  info,
  verify,
  generateKey,
  signAndSubmit,
  combineSignatures,
  mintTcnight,
  changeTerms,
  dustParticipants,
  mergeUtxos,
  build,
] as const;

/**
 * The options more than one command takes. A text option is parsed here,
 * at the boundary: its value reaches the program typed, and a bad one is
 * a ValidationError before any service is built.
 */
import { HelpDoc, Options, ValidationError } from "@effect/cli";
import { Either } from "effect";
import { ENVIRONMENTS, PROFILES, PROVIDERS } from "./config/network-mapping";
import {
  FORMATS,
  parseNonNegativeInteger,
  parseTxHash,
  parseTxIndex,
} from "./input";

/** Parse the text of option `name` through `parse`; a Left is the one-line ValidationError. */
export const parseWith =
  <A>(name: string, parse: (text: string) => Either.Either<A, string>) =>
  (options: Options.Options<string>) =>
    Options.mapEffect(options, (text) =>
      Either.mapLeft(parse(text), (reason) =>
        ValidationError.invalidValue(HelpDoc.p(`Invalid --${name}: ${reason}`)),
      ),
    );

/** A text option through `parse`; a Left is the one-line ValidationError. */
export const parsedText = <A>(
  name: string,
  parse: (text: string) => Either.Either<A, string>,
) => parseWith(name, parse)(Options.text(name));

/** --network, -n: the environment the command runs against. */
export const network = Options.choice("network", ENVIRONMENTS).pipe(
  Options.withAlias("n"),
  Options.withDescription("The environment (default: local)"),
  Options.withDefault("local"),
);

/** --network, -n of a test-only command: the environment; mainnet is refused by name. */
export const testNetwork = Options.choice("network", ENVIRONMENTS).pipe(
  Options.withAlias("n"),
  Options.withDescription(
    "The test environment (default: local; mainnet is refused)",
  ),
  Options.withDefault("local"),
  Options.mapEffect((environment) =>
    environment === "mainnet"
      ? Either.left(
          ValidationError.invalidValue(
            HelpDoc.p(
              "Invalid --network: mainnet is refused; this command runs only on a test environment",
            ),
          ),
        )
      : Either.right(environment),
  ),
);

/** --network, -n on a build: the aiken.toml profile. */
export const profile = Options.choice("network", PROFILES).pipe(
  Options.withAlias("n"),
  Options.withDescription("The aiken.toml profile (default: default)"),
  Options.withDefault("default"),
);

/** --provider, -p: the chain provider; absent, the environment's default. */
export const provider = Options.choice("provider", PROVIDERS).pipe(
  Options.withAlias("p"),
  Options.withDescription("The chain provider (default: the environment's)"),
  Options.optional,
);

/** --use-build: the build output's blueprint in place of the deployed one. */
export const useBuild = Options.boolean("use-build").pipe(
  Options.withDescription("Use build output instead of deployed blueprint"),
);

/** --format: a table or JSON. */
export const format = Options.choice("format", FORMATS).pipe(
  Options.withDescription("Output format (default: table)"),
  Options.withDefault("table"),
);

/** --output, -o: the directory the environment's files go under. */
export const outputDir = Options.text("output").pipe(
  Options.withAlias("o"),
  Options.withDescription("Output directory (default: ./deployments)"),
  Options.withDefault("./deployments"),
);

/** --output-file: the file name under the output directory. */
export const outputFile = (fallback: string) =>
  Options.text("output-file").pipe(
    Options.withDescription(`Output file name (default: ${fallback})`),
    Options.withDefault(fallback),
  );

/** --fee-padding: lovelace added to the fee; the default is text, parsed like an argument (--wizard prints it as JSON). */
export const feePadding = Options.text("fee-padding").pipe(
  Options.withDescription(
    "Fee padding in lovelace, 0 or greater (default: 50000)",
  ),
  Options.withDefault("50000"),
  parseWith("fee-padding", (text) =>
    Either.map(parseNonNegativeInteger(text), BigInt),
  ),
);

/** --tx-hash, --tx-index and --fee-padding: the deployer UTxO that pays the fee. */
export const feeUtxo = {
  txHash: parsedText("tx-hash", parseTxHash).pipe(
    Options.withDescription("Transaction hash for the fee-paying UTxO"),
  ),
  txIndex: parsedText("tx-index", parseTxIndex).pipe(
    Options.withDescription("Transaction index for the fee-paying UTxO"),
  ),
  feePadding,
};

/** --signing-key and --no-sign-deployer: whether the deployer signs, and the variable that holds its key. */
export const deployerSigning = {
  signingKey: Options.text("signing-key").pipe(
    Options.withDescription(
      "Environment variable with the deployer key (default: SIGNING_PRIVATE_KEY)",
    ),
    Options.withDefault("SIGNING_PRIVATE_KEY"),
  ),
  signDeployer: Options.boolean("no-sign-deployer").pipe(
    Options.withDescription("Do not sign with the deployer key"),
    Options.map((unsigned) => !unsigned),
  ),
};

/** --no-sign: leave the transaction unsigned; the value is whether to sign, which reads the `keys` variables. */
export const sign = (keys: string) =>
  Options.boolean("no-sign").pipe(
    Options.withDescription(
      `Leave the transaction unsigned (signing reads ${keys})`,
    ),
    Options.map((unsigned) => !unsigned),
  );

type OptionsRecord = Record<string, Options.Options<unknown>>;

/** A governance transaction's options in help order: --network, --provider, `head`, the fee UTxO, `afterFee`, --no-sign (both authorities) and --output-file <name>-tx.json. */
export const governanceTxOptions = <
  Head extends OptionsRecord,
  AfterFee extends OptionsRecord = Record<never, never>,
>(
  name: string,
  head: Head,
  afterFee = {} as AfterFee,
) => ({
  network,
  provider,
  ...head,
  ...feeUtxo,
  ...afterFee,
  sign: sign("TECH_AUTH_PRIVATE_KEYS and COUNCIL_PRIVATE_KEYS"),
  outputFile: outputFile(`${name}-tx.json`),
});

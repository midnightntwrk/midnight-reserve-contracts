/**
 * The transaction file the CLI writes and sign-and-submit / combine-signatures
 * read (one transaction), and the deployment files deploy and
 * deploy-staging-track write (many).
 */
import { FileSystem } from "@effect/platform";
import { Effect, Either, ParseResult, Schema } from "effect";
import { InputParseError, type FileWriteError } from "../errors";
import { Output } from "../output";

/** The type field of every transaction file. */
export const TX_TYPE_CONWAY = "Tx ConwayEra";

/** One transaction file. */
const TransactionFile = Schema.Struct({
  type: Schema.String,
  description: Schema.String,
  cborHex: Schema.String,
  txHash: Schema.String,
  signed: Schema.Boolean,
}).annotations({ identifier: "TransactionFile" });
export type TransactionFile = typeof TransactionFile.Type;

/** A deployment file as deploy writes it. */
export const DeploymentFile = Schema.Struct({
  network: Schema.String,
  timestamp: Schema.String,
  transactions: Schema.Array(TransactionFile),
}).annotations({ identifier: "DeploymentFile" });

/** The part of a deployment file its readers use. */
export const DeploymentTransactions = DeploymentFile.pick(
  "transactions",
).annotations({ identifier: "DeploymentTransactions" });

/** A decode failure as one line per issue, `path: message`. */
const issuesOf = (error: ParseResult.ParseError): string[] =>
  ParseResult.ArrayFormatter.formatErrorSync(error).map(({ path, message }) =>
    path.length === 0 ? message : `${path.map(String).join(".")}: ${message}`,
  );

/** The transactions of JSON that is a deployment file (it has `transactions`) or one transaction file; the issues name the fields that are missing or wrong. */
const transactionsOf = (
  json: unknown,
): Either.Either<readonly TransactionFile[], string[]> =>
  typeof json === "object" && json !== null && "transactions" in json
    ? Either.mapBoth(
        Schema.decodeUnknownEither(DeploymentTransactions)(json, {
          errors: "all",
        }),
        { onLeft: issuesOf, onRight: (file) => file.transactions },
      )
    : Either.mapBoth(
        Schema.decodeUnknownEither(TransactionFile)(json, { errors: "all" }),
        {
          onLeft: issuesOf,
          onRight: (file) => [file],
        },
      );

/** The transactions of a transaction file (one) or a deployment file (each); unreadable or malformed is an InputParseError with one line per issue. */
export const readTransactionFile = (
  path: string,
): Effect.Effect<
  readonly TransactionFile[],
  InputParseError,
  FileSystem.FileSystem
> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.flatMap(
      Effect.mapError(
        fs.readFileString(path),
        (cause) =>
          new InputParseError({ source: path, issues: [cause.message] }),
      ),
      (text) =>
        Either.mapLeft(
          Either.flatMap(
            Either.try({
              try: (): unknown => JSON.parse(text),
              catch: (cause) => [
                `not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
              ],
            }),
            transactionsOf,
          ),
          (issues) => new InputParseError({ source: path, issues }),
        ),
    ),
  );

/** The file of one transaction. */
export const transactionFile = (
  cbor: string,
  txHash: string,
  signed: boolean,
  description: string,
): TransactionFile => ({
  type: TX_TYPE_CONWAY,
  description,
  cborHex: cbor,
  txHash,
  signed,
});

/** Write one transaction file through Output and print its path. */
export const writeTransaction = (
  filePath: string,
  cbor: string,
  txHash: string,
  signed: boolean,
  description: string,
): Effect.Effect<void, FileWriteError, Output> =>
  Effect.flatMap(Output, (output) =>
    Effect.zipRight(
      output.writeJson(
        filePath,
        transactionFile(cbor, txHash, signed, description),
      ),
      output.log(`Transaction written to ${filePath}`),
    ),
  );

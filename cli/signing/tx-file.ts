/**
 * The transaction file the CLI writes and sign-and-submit / combine-signatures
 * read (one transaction), and the deployment files deploy and
 * deploy-staging-track write (many).
 */
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { InputParseError, type FileWriteError } from "../errors";
import { readJsonFile } from "../input";
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

/** The transactions of a transaction file (one) or a deployment file (each); unreadable or malformed is an InputParseError. */
export const readTransactionFile = (
  path: string,
): Effect.Effect<
  readonly TransactionFile[],
  InputParseError,
  FileSystem.FileSystem
> =>
  Effect.map(
    readJsonFile(
      path,
      Schema.Union(DeploymentTransactions, TransactionFile),
      (reason) => new InputParseError({ source: path, issues: [reason] }),
    ),
    (file) => ("transactions" in file ? file.transactions : [file]),
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

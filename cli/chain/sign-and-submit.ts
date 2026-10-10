/**
 * sign-and-submit: sign each transaction of a file with the deployer key
 * (unless --no-sign-deployer), submit them all, then await every
 * confirmation. A failed transaction does not stop the others; the summary
 * lists both outcomes and the command fails when any transaction failed.
 */
import {
  HexBlob,
  Transaction,
  TxCBOR,
  type TransactionId,
} from "@blaze-cardano/core";
import { Effect, Either, Option } from "effect";
import { Settings } from "../config/settings";
import type { PrivateKey } from "../datum/signers";
import { Output } from "../output";
import { readTransactionFile } from "./tx-file";
import { describeCause, renderError, SubmitError } from "../errors";
import { attachWitnesses, signTransaction } from "./transaction";
import { awaitConfirmation, submitTx } from "./submit";

/** Whether the deployer signs, and the variable that holds its key. */
export interface DeployerKeyInput {
  readonly signingKey: string;
  readonly signDeployer: boolean;
}

/** The transaction file to sign and submit, and the deployer signing. */
export interface SignAndSubmitInput extends DeployerKeyInput {
  readonly jsonFile: string;
}

/** A transaction that could not be submitted or confirmed, with the reason. */
type Failure = { readonly name: string; readonly error: string };

/** The deployer key named by --signing-key, or none with --no-sign-deployer. */
export const deployerKey = (input: DeployerKeyInput) =>
  input.signDeployer
    ? Effect.map(
        Effect.flatMap(Settings, (settings) =>
          settings.signingKey(input.signingKey),
        ),
        Option.some,
      )
    : Effect.succeed(Option.none<PrivateKey>());

/** Decode transaction CBOR; a malformed one gives its reason. */
export const decodeTransaction = (
  cborHex: string,
): Either.Either<Transaction, string> =>
  Either.mapLeft(
    Either.try(() => Transaction.fromCbor(TxCBOR(HexBlob(cborHex)))),
    describeCause,
  );

/** Submit a signed transaction; any failure becomes its rendered reason. */
export const submit = (tx: Transaction, name: string) =>
  Effect.mapError(submitTx(tx, name), renderError);

/** Await a confirmation; any failure becomes its rendered reason. */
export const confirm = (txId: TransactionId, name: string) =>
  Effect.mapError(awaitConfirmation(txId, name), renderError);

/** Print the summary; fail when any transaction failed. */
export const summary = (
  command: string,
  confirmed: readonly TransactionId[],
  failed: readonly Failure[],
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log("\n--- Summary ---");
    if (confirmed.length > 0) {
      yield* output.log(
        `\nSuccessfully confirmed ${confirmed.length} transaction(s):`,
      );
      yield* Effect.forEach(confirmed, (hash) => output.log(`  ${hash}`));
    }
    if (failed.length > 0) {
      yield* output.log(`\nFailed ${failed.length} transaction(s):`);
      yield* Effect.forEach(failed, ({ name, error }) =>
        output.log(`  ${name}: ${error}`),
      );
      return yield* new SubmitError({
        cause: new Error(`${command}: ${failed.length} transaction(s) failed`),
      });
    }
  });

/** Decode, sign with the key when there is one, and submit one file entry. */
export const signAndSubmitOne = (
  entry: { readonly cborHex: string; readonly description: string },
  key: Option.Option<PrivateKey>,
) =>
  Effect.flatMap(
    Either.map(decodeTransaction(entry.cborHex), (tx) =>
      Option.match(key, {
        onNone: () => tx,
        onSome: (k) =>
          attachWitnesses(tx.toCbor(), signTransaction(tx.getId(), [k])),
      }),
    ),
    (signed) => submit(signed, entry.description),
  );

/** Sign and submit every transaction of the file, then await each confirmation. */
export const signAndSubmitProgram = (input: SignAndSubmitInput) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const key = yield* deployerKey(input);
    yield* output.progress(
      Option.isSome(key)
        ? `Signing with deployer key from ${input.signingKey}`
        : "Submitting without deployer signature (--no-sign-deployer)",
    );
    const transactions = yield* readTransactionFile(input.jsonFile);
    yield* output.progress(
      `Found ${transactions.length} transactions to process`,
    );
    const submitted: { name: string; txId: TransactionId }[] = [];
    const submitFailures: Failure[] = [];
    for (const entry of transactions) {
      const name = entry.description;
      const result = yield* Effect.either(signAndSubmitOne(entry, key));
      if (Either.isRight(result)) {
        submitted.push({ name, txId: result.right });
        yield* output.success(`Submitted: ${name} - ${result.right}`);
      } else {
        submitFailures.push({ name, error: result.left });
        yield* output.error(`Failed to submit ${name}: ${result.left}`);
      }
    }
    if (submitted.length > 0) {
      yield* output.progress(
        `\nSubmitted ${submitted.length}/${transactions.length} transactions. Awaiting confirmations...`,
      );
    }
    const confirmed: TransactionId[] = [];
    const failed: Failure[] = [];
    for (const { name, txId } of submitted) {
      const result = yield* Effect.either(confirm(txId, name));
      if (Either.isRight(result)) {
        confirmed.push(txId);
        yield* output.success(`Confirmed: ${name} - ${txId}`);
      } else {
        failed.push({ name, error: result.left });
        yield* output.error(`Confirmation failed for ${name}: ${result.left}`);
      }
    }
    yield* summary("sign-and-submit", confirmed, [
      ...failed,
      ...submitFailures,
    ]);
  });

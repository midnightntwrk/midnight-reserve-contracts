/**
 * combine-signatures: merge external witness files into one transaction,
 * optionally add the deployer signature, then submit and await the
 * confirmation. A witness file is a cardano-cli TextEnvelope key witness,
 * tagged `[0, [vkey, sig]]` or untagged `[vkey, sig]` (as cardano-cli 10.14
 * writes it), or a CIP-30 witness set as raw CBOR hex. The transaction file
 * and every witness are parsed, and every witness is verified against the
 * transaction id, before anything is submitted.
 */
import {
  CborSet,
  Ed25519PublicKeyHex,
  Ed25519SignatureHex,
  fromHex,
  HexBlob,
  type TransactionId,
  TransactionWitnessSet,
  VkeyWitness,
} from "@blaze-cardano/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { FileSystem } from "@effect/platform";
import { Effect, Either, Option } from "effect";
import { Output } from "../output";
import { readTransactionFile } from "./tx-file";
import { describeCause, InputParseError } from "../errors";
import { signTransaction } from "./transaction";
import {
  confirm,
  decodeTransaction,
  type DeployerKeyInput,
  deployerKey,
  submit,
  summary,
} from "./sign-and-submit";

/** The transaction file, the witness files to merge into it, and the deployer signing. */
export interface CombineSignaturesInput extends DeployerKeyInput {
  readonly tx: string;
  readonly witnessFiles: readonly string[];
}

/** A vkey and its signature. */
export type Signature = [Ed25519PublicKeyHex, Ed25519SignatureHex];

/** The cardano-cli witness file shape. */
type TextEnvelope = { type: string; cborHex: string };

const jsonOf = (text: string): Option.Option<unknown> =>
  Either.getRight(Either.try((): unknown => JSON.parse(text)));

const isTextEnvelope = (value: unknown): value is TextEnvelope =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  "description" in value &&
  "cborHex" in value &&
  typeof value.type === "string" &&
  typeof value.cborHex === "string";

/** A cardano-cli key witness, `[0, [vkey, sig]]` or `[vkey, sig]`, with a 32-byte vkey and a 64-byte signature. */
const KEY_WITNESS = /^(?:8200)?825820([0-9a-f]{64})5840([0-9a-f]{128})$/;

/** The one vkey witness of a cardano-cli envelope. */
const parseCardanoCliWitness = (
  envelope: TextEnvelope,
): Either.Either<Signature[], string> => {
  const match = KEY_WITNESS.exec(envelope.cborHex.toLowerCase());
  return match?.[1] && match[2]
    ? Either.right([
        [Ed25519PublicKeyHex(match[1]), Ed25519SignatureHex(match[2])],
      ])
    : Either.left(
        "Failed to parse cardano-cli witness: expected a key witness [0, [vkey (32 bytes), signature (64 bytes)]] or [vkey (32 bytes), signature (64 bytes)]",
      );
};

/** The vkey witnesses of a CBOR witness set, each a 32-byte vkey and a 64-byte signature. */
const parseWalletWitnessSet = (
  cborHex: string,
): Either.Either<Signature[], string> =>
  Either.mapLeft(
    Either.try(() =>
      (
        TransactionWitnessSet.fromCbor(HexBlob(cborHex)).vkeys()?.values() ?? []
      ).map((v): Signature => [
        Ed25519PublicKeyHex(v.vkey()),
        Ed25519SignatureHex(v.signature()),
      ]),
    ),
    (cause) => `Invalid CBOR witness set: ${describeCause(cause)}`,
  );

/** Whether the signature is the vkey's Ed25519 signature over the transaction id, by the ledger's strict (non-ZIP-215) rule. */
const signs = (txId: TransactionId, [vkey, sig]: Signature): boolean =>
  ed25519.verify(fromHex(sig), fromHex(txId), fromHex(vkey), { zip215: false });

/** Read and parse one witness file and verify its signatures against the transaction id; a failure is an InputParseError naming the file. */
export const readWitnessFile = (path: string, txId: TransactionId) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const output = yield* Output;
    const invalid = (issues: string[]) =>
      new InputParseError({ source: path, issues });
    const content = yield* Effect.mapError(fs.readFileString(path), (cause) =>
      invalid([`Witness file not found (${cause.message})`]),
    );
    const parsed = Option.match(
      Option.filter(jsonOf(content), isTextEnvelope),
      {
        onSome: parseCardanoCliWitness,
        onNone: () => parseWalletWitnessSet(content.trim()),
      },
    );
    const signatures = yield* Effect.mapError(parsed, (issue) =>
      invalid([issue]),
    );
    const unverified = signatures.filter((s) => !signs(txId, s));
    if (unverified.length > 0) {
      return yield* invalid(
        unverified.map(
          ([vkey]) =>
            `The signature by ${vkey} does not verify against transaction ${txId}`,
        ),
      );
    }
    yield* output.info(
      `  Extracted ${signatures.length} signature(s) from ${path}`,
    );
    return signatures;
  });

/** The vkey witnesses by public key. */
export type Witnesses = ReadonlyMap<Ed25519PublicKeyHex, Ed25519SignatureHex>;

/** Add signatures by public key; a key already present with another signature is refused. */
export const mergeWitnesses = (
  witnesses: Witnesses,
  signatures: readonly Signature[],
): Either.Either<Witnesses, string> => {
  const merged = new Map(witnesses);
  for (const [vkey, sig] of signatures) {
    const existing = merged.get(vkey);
    if (existing !== undefined && existing !== sig) {
      return Either.left(
        `Duplicate signer with a different signature for public key ${vkey}`,
      );
    }
    merged.set(vkey, sig);
  }
  return Either.right(merged);
};

/** The transaction of a file that holds one; a deployment file of several is refused. */
export const readSingleTransaction = (path: string) =>
  Effect.flatMap(readTransactionFile(path), (transactions) =>
    transactions.length === 1
      ? Effect.succeed(transactions[0])
      : Effect.fail(
          new InputParseError({
            source: path,
            issues: [
              "combine-signatures only supports single-transaction files. " +
                "For multi-transaction deployments, use sign-and-submit instead.",
            ],
          }),
        ),
  );

/** Merge the witnesses into the single transaction of --tx, sign it as the deployer if asked, submit it and await the confirmation. */
export const combineSignaturesProgram = (input: CombineSignaturesInput) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const key = yield* deployerKey(input);
    if (Option.isSome(key)) {
      yield* output.progress(
        `Will also sign with deployer key from ${input.signingKey}`,
      );
    }

    const { cborHex, description } = yield* readSingleTransaction(input.tx);
    const tx = yield* Effect.mapError(
      decodeTransaction(cborHex),
      (reason) => new InputParseError({ source: input.tx, issues: [reason] }),
    );
    const txId = tx.getId();

    const files = yield* Effect.forEach(input.witnessFiles, (path) =>
      Effect.map(readWitnessFile(path, txId), (signatures) => ({
        path,
        signatures,
      })),
    );
    const total = files.reduce((n, f) => n + f.signatures.length, 0);
    if (total === 0) {
      return yield* new InputParseError({
        source: "<witness-file>",
        issues: ["No valid signatures found across all witness files"],
      });
    }
    yield* output.info(`Total signatures to merge: ${total}`);
    const existing: Witnesses = new Map(
      (tx.witnessSet().vkeys()?.values() ?? []).map((v) => [
        v.vkey(),
        v.signature(),
      ]),
    );
    const fromFiles = yield* Effect.reduce(
      files,
      existing,
      (witnesses, { path, signatures }) =>
        Effect.mapError(
          mergeWitnesses(witnesses, signatures),
          (issue) => new InputParseError({ source: path, issues: [issue] }),
        ),
    );
    const deployer = signTransaction(txId, Option.toArray(key));
    const witnesses = yield* Effect.mapError(
      mergeWitnesses(fromFiles, deployer),
      (issue) =>
        new InputParseError({ source: input.signingKey, issues: [issue] }),
    );
    if (Option.isSome(key)) {
      yield* output.info("Added deployer signature");
    }
    const witnessSet = tx.witnessSet();
    witnessSet.setVkeys(CborSet.fromCore([...witnesses], VkeyWitness.fromCore));
    tx.setWitnessSet(witnessSet);

    const outcome = yield* Effect.either(
      Effect.tap(submit(tx, description), (id) => confirm(id, description)),
    );
    if (Either.isRight(outcome)) {
      yield* output.success(`Confirmed: ${outcome.right}`);
      yield* summary("combine-signatures", [outcome.right], []);
    } else {
      yield* output.error(`Failed: ${outcome.left}`);
      yield* summary(
        "combine-signatures",
        [],
        [{ name: description, error: outcome.left }],
      );
    }
  });

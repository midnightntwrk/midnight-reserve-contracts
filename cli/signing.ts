/**
 * Signing and submission: the transaction file, vkey witnesses of a
 * transaction id, the output pipeline of a transaction command
 * (compileReported, then signAndWrite or writeTransaction), and the
 * sign-and-submit and combine-signatures programs, which submit through
 * Provider. Only this module and main.ts import keys.ts.
 */
import { dirname } from "path";
import {
  CborSet,
  Ed25519PrivateExtendedKeyHex,
  Ed25519PrivateKey,
  Ed25519PrivateNormalKeyHex,
  Ed25519PublicKey,
  Ed25519PublicKeyHex,
  Ed25519Signature,
  Ed25519SignatureHex,
  HexBlob,
  initCrypto,
  Transaction,
  type TransactionId,
  TransactionWitnessSet,
  TxCBOR,
  VkeyWitness,
} from "@blaze-cardano/core";
import {
  Duration,
  Effect,
  FileSystem,
  Option,
  Result,
  Schedule,
  Schema,
  SchemaIssue,
} from "effect";
import { ATTEMPTS, Provider, retrying } from "./chain";
import {
  type ConfigError,
  FileWriteError,
  InputParseError,
  type ProviderError,
  renderError,
  SubmitError,
} from "./errors";
import { readJsonFile } from "./input";
import { type KeyGroup, Keys, type PrivateKey } from "./keys";
import { Output } from "./output";
import { compile, type PlanningContext, type TxPlan } from "./tx";

/** One transaction, as the CLI writes it and sign-and-submit and combine-signatures read it. */
const TransactionFile = Schema.Struct({
  type: Schema.String,
  description: Schema.String,
  cborHex: Schema.String,
  txHash: Schema.String,
  signed: Schema.Boolean,
});
export type TransactionFile = typeof TransactionFile.Type;

/** The part of a deployment file (deploy's, of many transactions) its readers use. */
const DeploymentTransactions = Schema.Struct({
  transactions: Schema.Array(TransactionFile),
});

const standardIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** The transactions of a transaction file (one) or a deployment file (each). An unreadable or malformed file is an InputParseError with one line per issue, `path: message`. */
export const readTransactionFile = (
  path: string,
): Effect.Effect<
  readonly TransactionFile[],
  InputParseError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const invalid = (issues: readonly string[]) =>
      new InputParseError({ source: path, issues });
    const json = yield* readJsonFile(path, Schema.Unknown, (reason) =>
      invalid([reason]),
    );
    const decoded: Result.Result<
      readonly TransactionFile[],
      Schema.SchemaError
    > =
      typeof json === "object" && json !== null && "transactions" in json
        ? Result.map(
            Schema.decodeUnknownResult(DeploymentTransactions)(json, {
              errors: "all",
            }),
            (file) => file.transactions,
          )
        : Result.map(
            Schema.decodeUnknownResult(TransactionFile)(json, {
              errors: "all",
            }),
            (file) => [file],
          );
    return yield* Effect.fromResult(
      Result.mapError(decoded, (error) =>
        invalid(
          standardIssues(error.issue).issues.map(({ path, message }) =>
            path === undefined || path.length === 0
              ? message
              : `${path.map((key) => String(typeof key === "object" ? key.key : key)).join(".")}: ${message}`,
          ),
        ),
      ),
    );
  });

/** The file entry of one transaction. */
export const transactionFileOf = (
  tx: Transaction,
  signed: boolean,
  description: string,
): TransactionFile => ({
  type: "Tx ConwayEra",
  description,
  cborHex: tx.toCbor(),
  txHash: tx.getId(),
  signed,
});

/** Write a deployment file, `{network, timestamp, transactions}`, creating its directory. */
export const writeDeploymentFile = (
  path: string,
  file: {
    readonly network: string;
    readonly timestamp: string;
    readonly transactions: readonly TransactionFile[];
  },
): Effect.Effect<void, FileWriteError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.mapError(
      Effect.andThen(
        fs.makeDirectory(dirname(path), { recursive: true }),
        fs.writeFileString(path, JSON.stringify(file, null, 2)),
      ),
      (cause) => new FileWriteError({ path, reason: cause.message }),
    ),
  );

/** Write one transaction file, creating its directory. */
export const writeTransactionFile = (
  path: string,
  tx: Transaction,
  signed: boolean,
  description: string,
): Effect.Effect<void, FileWriteError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => {
    const file = transactionFileOf(tx, signed, description);
    return Effect.mapError(
      Effect.andThen(
        fs.makeDirectory(dirname(path), { recursive: true }),
        fs.writeFileString(path, JSON.stringify(file, null, 2)),
      ),
      (cause) => new FileWriteError({ path, reason: cause.message }),
    );
  });

/** Write one transaction file, creating its directory, and print its path. */
export const writeTransaction = (
  path: string,
  tx: Transaction,
  signed: boolean,
  description: string,
): Effect.Effect<void, FileWriteError, FileSystem.FileSystem | Output> =>
  Effect.gen(function* () {
    yield* writeTransactionFile(path, tx, signed, description);
    yield* (yield* Output).log(`Transaction written to ${path}`);
  });

/** A public key and its signature of a transaction id. */
export type KeySignature = readonly [Ed25519PublicKeyHex, Ed25519SignatureHex];

/** The vkey witnesses of a transaction, by public key. */
export type Witnesses = ReadonlyMap<Ed25519PublicKeyHex, Ed25519SignatureHex>;

/** libsodium, through which @cardano-sdk/crypto signs and verifies, loaded once per process; a load failure is a defect. */
const sodium = Effect.orDie(Effect.tryPromise(() => initCrypto()));

/** Each key's public key and Ed25519 signature of the transaction id. */
export const signTransaction = (
  txId: TransactionId,
  keys: readonly PrivateKey[],
): Effect.Effect<KeySignature[]> =>
  Effect.map(sodium, () =>
    keys.map((key): KeySignature => {
      const privateKey =
        key.length === 128
          ? Ed25519PrivateKey.fromExtendedHex(Ed25519PrivateExtendedKeyHex(key))
          : Ed25519PrivateKey.fromNormalHex(Ed25519PrivateNormalKeyHex(key));
      return [
        privateKey.toPublic().hex(),
        privateKey.sign(HexBlob(txId)).hex(),
      ];
    }),
  );

/** The vkey witnesses a transaction carries. */
const witnessesOf = (tx: Transaction): Witnesses =>
  new Map(
    (tx.witnessSet().vkeys()?.values() ?? []).map((witness) => [
      witness.vkey(),
      witness.signature(),
    ]),
  );

/** Add signatures by public key; a key already present with another signature is refused. */
export const mergeWitnesses = (
  witnesses: Witnesses,
  signatures: readonly KeySignature[],
): Result.Result<Witnesses, string> => {
  const merged = new Map(witnesses);
  for (const [vkey, signature] of signatures) {
    const existing = merged.get(vkey);
    if (existing !== undefined && existing !== signature) {
      return Result.fail(
        `Duplicate signer with a different signature for public key ${vkey}`,
      );
    }
    merged.set(vkey, signature);
  }
  return Result.succeed(merged);
};

/** A copy of the transaction with `witnesses` as its vkey witnesses; the body, and so the id, is unchanged. */
const withWitnesses = (tx: Transaction, witnesses: Witnesses): Transaction => {
  const copy = Transaction.fromCbor(tx.toCbor());
  const witnessSet = copy.witnessSet();
  witnessSet.setVkeys(
    CborSet.fromCore([...witnesses], (core) => VkeyWitness.fromCore(core)),
  );
  copy.setWitnessSet(witnessSet);
  return copy;
};

const KEY_GROUP_LABELS: Record<KeyGroup, string> = {
  techAuth: "tech auth",
  council: "council",
};

/** The groups that sign a governance transaction: both authorities, or the tech authority alone. */
const SIGNING_GROUPS = {
  both: ["techAuth", "council"],
  "tech-auth": ["techAuth"],
} as const satisfies Record<string, readonly KeyGroup[]>;

/** The keys of each group that signs a transaction, or no signing. */
export type Signer =
  | { readonly _tag: "Unsigned" }
  | {
      readonly _tag: "Signed";
      readonly groups: readonly {
        readonly group: KeyGroup;
        readonly keys: readonly PrivateKey[];
      }[];
    };

/** A transaction written without witnesses. */
export const UNSIGNED: Signer = { _tag: "Unsigned" };

/** The signer for `--sign`: every key of the groups of `signing`, read at once, so a missing key fails before any chain read. */
export const signerFor = (
  sign: boolean,
  signing: keyof typeof SIGNING_GROUPS,
): Effect.Effect<Signer, ConfigError, Keys> =>
  sign
    ? Effect.gen(function* () {
        const keys = yield* Keys;
        const groups = yield* Effect.forEach(SIGNING_GROUPS[signing], (group) =>
          Effect.map(keys.privateKeys(group), (groupKeys) => ({
            group,
            keys: groupKeys,
          })),
        );
        return { _tag: "Signed", groups };
      })
    : Effect.succeed(UNSIGNED);

/** Write a transaction file with a vkey witness from every key of `signer`. */
export const signAndWrite = (
  tx: Transaction,
  path: string,
  signer: Signer,
  description: string,
): Effect.Effect<void, FileWriteError, FileSystem.FileSystem | Output> =>
  Effect.gen(function* () {
    const output = yield* Output;
    const txId = tx.getId();
    if (signer._tag === "Unsigned") {
      yield* writeTransaction(path, tx, false, description);
    } else {
      const signatures: KeySignature[] = [];
      for (const { group, keys } of signer.groups) {
        yield* output.log(
          `\nSigning with ${keys.length} ${KEY_GROUP_LABELS[group]} private keys...`,
        );
        const created = yield* signTransaction(txId, keys);
        signatures.push(...created);
        yield* output.log(`  Created ${created.length} signatures`);
      }
      // One key in both groups signs twice with the same signature, which the map keeps once.
      const signed = withWitnesses(
        tx,
        new Map([...witnessesOf(tx), ...signatures]),
      );
      yield* writeTransaction(path, signed, true, description);
    }
    yield* output.log(`\nTransaction ID: ${txId}`);
  });

/** The deployer's vkey witness, which sign-and-submit adds to every transaction. */
const DEPLOYER_ONLY = 1;

/** The vkey witnesses a transaction carries at submit: every key of a Signed signer or, for an unsigned file, the `required` signatures its multisig witnesses need; and the deployer's. */
export const witnessCount = (signer: Signer, required: number): number =>
  DEPLOYER_ONLY +
  (signer._tag === "Signed"
    ? signer.groups.reduce((n, { keys }) => n + keys.length, 0)
    : required);

/** Compile a plan in its context, reported as the reference CLI reports it: a local check when the plan spends, references or offers UTxOs, and the transaction id. The file write that follows (signAndWrite, writeTransaction) ends the same output. */
export const compileReported = <Resolved>(
  plan: TxPlan,
  ctx: PlanningContext<Resolved>,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log("\nBuilding transaction...");
    const checked =
      plan.spends.length + plan.references.length + plan.collateral.length > 0;
    if (checked) yield* output.log("  Testing transaction locally (UPLC)...");
    const tx = yield* compile(plan, ctx);
    if (checked) yield* output.success("Local UPLC test passed");
    yield* output.success(`Transaction built: ${tx.getId()}`);
    return tx;
  });

/** The first delay between submission attempts; it doubles. */
const SUBMIT_RETRY_DELAY = Duration.seconds(2);
const CONFIRMATION_POLL = Duration.seconds(5);
const CONFIRMATION_TIMEOUT = Duration.minutes(5);

/** A failure worth another attempt: a retryable ProviderError (transport, timeout, 429, 5xx). */
const networkFailure = (error: ConfigError | ProviderError) =>
  error._tag === "ProviderError" && error.retryable;

/**
 * Submit a signed transaction, retrying network failures. Succeeds with the
 * id once the provider took it, once it is already on chain, or when a
 * network failure may have reached the node (the confirmation wait then
 * decides). A SubmitError when the provider refused every attempt.
 */
export const submitTransaction = (
  tx: Transaction,
  name: string,
): Effect.Effect<TransactionId, SubmitError, Provider | Output> =>
  Effect.gen(function* () {
    const provider = yield* Provider;
    const output = yield* Output;
    const txId = tx.getId();
    let attempts = 0;
    let outcomeUnknown = false;
    const attempt = Effect.gen(function* () {
      attempts += 1;
      yield* output.progress(
        attempts === 1
          ? `Submitting: ${name}`
          : `Submitting (attempt ${attempts}/${ATTEMPTS}): ${name}`,
      );
      const submitted = yield* Effect.result(provider.submit(tx));
      if (Result.isSuccess(submitted)) return txId;
      if (
        yield* Effect.orElseSucceed(provider.isConfirmed(txId), () => false)
      ) {
        yield* output.info(`Transaction already confirmed on-chain: ${name}`);
        return txId;
      }
      const error = submitted.failure;
      // A network failure may have reached the node; a 429 is the rate limiter refusing the request.
      if (
        networkFailure(error) &&
        !(error._tag === "ProviderError" && error.status === 429)
      ) {
        outcomeUnknown = true;
      }
      return yield* Effect.fail(error);
    });
    return yield* attempt.pipe(
      retrying(networkFailure, SUBMIT_RETRY_DELAY, (delay) =>
        Effect.annotateLogs(
          Effect.logWarning(
            `Network error, retrying in ${Duration.toSeconds(delay)}s...`,
          ),
          {
            op: "postTransactionToChain",
            txId,
            delaySeconds: Duration.toSeconds(delay),
          },
        ),
      ),
      Effect.catch((cause) =>
        outcomeUnknown
          ? Effect.as(
              Effect.annotateLogs(
                Effect.logWarning(
                  `Submission outcome unknown, awaiting confirmation: ${name} (last error: ${renderError(cause)})`,
                ),
                { op: "postTransactionToChain", txId },
              ),
              txId,
            )
          : Effect.fail(new SubmitError({ txId, attempts, cause })),
      ),
    );
  });

/** Poll every CONFIRMATION_POLL until the transaction is on chain, under CONFIRMATION_TIMEOUT; each lookup retries network failures. */
export const awaitConfirmation = (
  txId: TransactionId,
  name: string,
): Effect.Effect<void, SubmitError, Provider | Output> =>
  Effect.gen(function* () {
    const provider = yield* Provider;
    const output = yield* Output;
    let polls = 0;
    const poll = Effect.suspend(() => {
      polls += 1;
      let attempts = 0;
      return Effect.suspend(() => {
        attempts += 1;
        return attempts > 1
          ? Effect.andThen(
              output.progress(
                `Awaiting confirmation (attempt ${attempts}/${ATTEMPTS}): ${name}`,
              ),
              provider.isConfirmed(txId),
            )
          : provider.isConfirmed(txId);
      }).pipe(
        retrying(networkFailure, SUBMIT_RETRY_DELAY, (delay) =>
          Effect.annotateLogs(
            Effect.logWarning(
              `Network error during confirmation, retrying in ${Duration.toSeconds(delay)}s...`,
            ),
            {
              op: "awaitTransactionConfirmation",
              txId,
              delaySeconds: Duration.toSeconds(delay),
            },
          ),
        ),
        Effect.mapError((cause) => new SubmitError({ txId, attempts, cause })),
      );
    });
    yield* poll.pipe(
      Effect.repeat({
        schedule: Schedule.spaced(CONFIRMATION_POLL),
        until: (confirmed) => confirmed,
      }),
      Effect.timeoutOrElse({
        duration: CONFIRMATION_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new SubmitError({
              txId,
              attempts: polls,
              cause: new Error(
                `Transaction ${txId} was not confirmed within ${Duration.toMinutes(CONFIRMATION_TIMEOUT)} minutes`,
              ),
            }),
          ),
      }),
    );
  });

/** A transaction that was not submitted or not confirmed, with the reason. */
type Failure = { readonly name: string; readonly error: string };

/** Print the summary; fail when any transaction failed. */
const summary = (
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
      for (const txId of confirmed) yield* output.log(`  ${txId}`);
    }
    if (failed.length > 0) {
      yield* output.log(`\nFailed ${failed.length} transaction(s):`);
      for (const { name, error } of failed) {
        yield* output.log(`  ${name}: ${error}`);
      }
      return yield* new SubmitError({
        cause: new Error(`${command}: ${failed.length} transaction(s) failed`),
      });
    }
  });

/** Whether the deployer signs, and the variable that holds its key. */
export interface DeployerSigning {
  readonly signingKey: string;
  readonly signDeployer: boolean;
}

/** The deployer key in the variable --signing-key names, or none with --no-sign-deployer. */
const deployerKey = (
  input: DeployerSigning,
): Effect.Effect<Option.Option<PrivateKey>, ConfigError, Keys> =>
  input.signDeployer
    ? Effect.gen(function* () {
        const keys = yield* Keys;
        return Option.some(yield* keys.signingKey(input.signingKey));
      })
    : Effect.succeedNone;

/** Decode transaction CBOR; a malformed one gives its reason. */
const decodeTransaction = (
  cborHex: string,
): Effect.Effect<Transaction, string> =>
  Effect.try({
    try: () => Transaction.fromCbor(TxCBOR(HexBlob(cborHex))),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });

/** Sign each transaction of a file with the deployer key (unless --no-sign-deployer), submit them all, then await each confirmation. A failed transaction does not stop the others; the command fails when any failed. */
export const signAndSubmitProgram = (
  input: DeployerSigning & { readonly jsonFile: string },
) =>
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
    for (const { cborHex, description: name } of transactions) {
      const result = yield* Effect.result(
        Effect.gen(function* () {
          const tx = yield* decodeTransaction(cborHex);
          // As in signAndWrite, the deployer's new signature replaces one the file already has for its key.
          const signed = Option.isSome(key)
            ? withWitnesses(
                tx,
                new Map([
                  ...witnessesOf(tx),
                  ...(yield* signTransaction(tx.getId(), [key.value])),
                ]),
              )
            : tx;
          return yield* Effect.mapError(
            submitTransaction(signed, name),
            renderError,
          );
        }),
      );
      if (Result.isSuccess(result)) {
        submitted.push({ name, txId: result.success });
        yield* output.success(`Submitted: ${name} - ${result.success}`);
      } else {
        submitFailures.push({ name, error: result.failure });
        yield* output.error(`Failed to submit ${name}: ${result.failure}`);
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
      const result = yield* Effect.result(awaitConfirmation(txId, name));
      if (Result.isSuccess(result)) {
        confirmed.push(txId);
        yield* output.success(`Confirmed: ${name} - ${txId}`);
      } else {
        const error = renderError(result.failure);
        failed.push({ name, error });
        yield* output.error(`Confirmation failed for ${name}: ${error}`);
      }
    }
    yield* summary("sign-and-submit", confirmed, [
      ...failed,
      ...submitFailures,
    ]);
  });

/** A cardano-cli key witness, `[0, [vkey, sig]]` or `[vkey, sig]` (as cardano-cli 10.14 writes it), with a 32-byte vkey and a 64-byte signature. */
const KEY_WITNESS = /^(?:8200)?825820([0-9a-f]{64})5840([0-9a-f]{128})$/;

/** The cardano-cli witness file shape. */
const TextEnvelope = Schema.Struct({
  type: Schema.String,
  description: Schema.String,
  cborHex: Schema.String,
});

/**
 * The signatures of one witness file, each verified against the transaction
 * id. A file is a cardano-cli key witness envelope or a CIP-30 witness set
 * as CBOR hex. Verification is libsodium's crypto_sign_verify_detached, the
 * function the ledger calls. A failure is an InputParseError naming the
 * file.
 */
export const readWitnessFile = (
  path: string,
  txId: TransactionId,
): Effect.Effect<
  KeySignature[],
  InputParseError,
  FileSystem.FileSystem | Output
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const output = yield* Output;
    const invalid = (issues: readonly string[]) =>
      new InputParseError({ source: path, issues });
    const content = yield* Effect.mapError(fs.readFileString(path), (cause) =>
      invalid([`Witness file not found (${cause.message})`]),
    );
    const envelope = Option.filter(
      Option.liftThrowable((text: string): unknown => JSON.parse(text))(
        content,
      ),
      Schema.is(TextEnvelope),
    );
    const signatures = yield* Effect.mapError(
      Option.match(envelope, {
        onSome: ({ cborHex }) => {
          const match = KEY_WITNESS.exec(cborHex.toLowerCase());
          return match?.[1] && match[2]
            ? Effect.succeed([
                [Ed25519PublicKeyHex(match[1]), Ed25519SignatureHex(match[2])],
              ] satisfies KeySignature[])
            : Effect.fail(
                "Failed to parse cardano-cli witness: expected a key witness [0, [vkey (32 bytes), signature (64 bytes)]] or [vkey (32 bytes), signature (64 bytes)]",
              );
        },
        onNone: () =>
          Effect.try({
            try: () =>
              (
                TransactionWitnessSet.fromCbor(HexBlob(content.trim()))
                  .vkeys()
                  ?.values() ?? []
              ).map((witness): KeySignature => [
                Ed25519PublicKeyHex(witness.vkey()),
                Ed25519SignatureHex(witness.signature()),
              ]),
            catch: (cause) =>
              `Invalid CBOR witness set: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      }),
      (issue) => invalid([issue]),
    );
    yield* sodium;
    const unverified = signatures.filter(
      ([vkey, signature]) =>
        !Ed25519PublicKey.fromHex(vkey).verify(
          Ed25519Signature.fromHex(signature),
          HexBlob(txId),
        ),
    );
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

/** Merge the witness files into the single transaction of --tx, sign it as the deployer unless --no-sign-deployer, submit it and await the confirmation. Every witness is read and verified before anything is submitted. */
export const combineSignaturesProgram = (
  input: DeployerSigning & {
    readonly tx: string;
    readonly witnessFiles: readonly string[];
  },
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const key = yield* deployerKey(input);
    if (Option.isSome(key)) {
      yield* output.progress(
        `Will also sign with deployer key from ${input.signingKey}`,
      );
    }
    const transactions = yield* readTransactionFile(input.tx);
    if (transactions.length !== 1) {
      return yield* new InputParseError({
        source: input.tx,
        issues: [
          "combine-signatures only supports single-transaction files. For multi-transaction deployments, use sign-and-submit instead.",
        ],
      });
    }
    const [{ cborHex, description }] = transactions;
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
    const total = files.reduce((n, file) => n + file.signatures.length, 0);
    if (total === 0) {
      return yield* new InputParseError({
        source: "<witness-file>",
        issues: ["No valid signatures found across all witness files"],
      });
    }
    yield* output.info(`Total signatures to merge: ${total}`);
    let witnesses = witnessesOf(tx);
    for (const { path, signatures } of files) {
      witnesses = yield* Effect.mapError(
        Effect.fromResult(mergeWitnesses(witnesses, signatures)),
        (issue) => new InputParseError({ source: path, issues: [issue] }),
      );
    }
    witnesses = yield* Effect.mapError(
      Effect.fromResult(
        mergeWitnesses(
          witnesses,
          yield* signTransaction(txId, Option.toArray(key)),
        ),
      ),
      (issue) =>
        new InputParseError({ source: input.signingKey, issues: [issue] }),
    );
    if (Option.isSome(key)) yield* output.info("Added deployer signature");
    const outcome = yield* Effect.result(
      Effect.tap(
        submitTransaction(withWitnesses(tx, witnesses), description),
        (txId) => awaitConfirmation(txId, description),
      ),
    );
    if (Result.isSuccess(outcome)) {
      yield* output.success(`Confirmed: ${outcome.success}`);
      yield* summary("combine-signatures", [outcome.success], []);
    } else {
      const error = renderError(outcome.failure);
      yield* output.error(`Failed: ${error}`);
      yield* summary("combine-signatures", [], [{ name: description, error }]);
    }
  });

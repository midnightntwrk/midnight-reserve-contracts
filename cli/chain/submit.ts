/**
 * Submission and confirmation with retries on retryable provider failures
 * (Provider.use classifies them).
 */
import type { Transaction, TransactionId } from "@blaze-cardano/core";
import { Duration, Effect, Ref, Schedule } from "effect";
import { Output } from "../output";
import { Provider } from "./provider";
import { retryBackoff } from "./blockfrost";
import { type ConfigError, type ProviderError, SubmitError } from "../errors";

const CONFIRMATION_TIMEOUT = Duration.minutes(5);
const CONFIRMATION_POLL = Duration.seconds(5);
const MAX_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY = Duration.seconds(2);

const networkFailure = (error: ProviderError | ConfigError) =>
  error._tag === "ProviderError" && error.retryable;

/** Backoff from 2 s, MAX_ATTEMPTS in total, on network failures only; `announce` runs with the delay before each retry. */
const retryNetwork = (
  announce: (delay: Duration.Duration) => Effect.Effect<void>,
) => retryBackoff(INITIAL_RETRY_DELAY, MAX_ATTEMPTS, networkFailure, announce);

/** One lookup without a wait; any failure counts as "not on chain". */
const alreadyOnChain = (txId: TransactionId) =>
  Effect.flatMap(Provider, (provider) =>
    provider
      .use("awaitTransactionConfirmation", (p) =>
        p.awaitTransactionConfirmation(txId, 0),
      )
      .pipe(Effect.orElseSucceed(() => false)),
  );

/** Submit a signed transaction with retries on network errors, returning the id once it landed or its outcome is unknown (a network error may have reached the node); a SubmitError only when the provider rejected every attempt. */
export const submitTx = (
  tx: Transaction,
  name: string,
): Effect.Effect<TransactionId, SubmitError, Provider | Output> =>
  Effect.gen(function* () {
    const provider = yield* Provider;
    const output = yield* Output;
    const txId = tx.getId();
    const attempts = yield* Ref.make(0);
    const outcomeUnknown = yield* Ref.make(false);
    const attempt = Effect.gen(function* () {
      const n = yield* Ref.updateAndGet(attempts, (a) => a + 1);
      yield* output.progress(
        n === 1
          ? `Submitting: ${name}`
          : `Submitting (attempt ${n}/${MAX_ATTEMPTS}): ${name}`,
      );
      return yield* provider
        .use("postTransactionToChain", (p) => p.postTransactionToChain(tx))
        .pipe(
          Effect.as(txId),
          Effect.catchAll((error) =>
            Effect.flatMap(alreadyOnChain(txId), (landed) =>
              landed
                ? Effect.tap(Effect.succeed(txId), () =>
                    output.info(
                      `Transaction already confirmed on-chain: ${name}`,
                    ),
                  )
                : Effect.zipRight(
                    networkFailure(error)
                      ? Ref.set(outcomeUnknown, true)
                      : Effect.void,
                    Effect.fail(error),
                  ),
            ),
          ),
        );
    });
    return yield* attempt.pipe(
      retryNetwork((delay) =>
        Effect.logWarning(
          `Network error, retrying in ${Duration.toSeconds(delay)}s...`,
        ).pipe(
          Effect.annotateLogs({
            op: "postTransactionToChain",
            txId,
            delaySeconds: Duration.toSeconds(delay),
          }),
        ),
      ),
      Effect.catchAll((cause) =>
        Effect.flatMap(Ref.get(outcomeUnknown), (unknown) =>
          unknown
            ? Effect.as(
                Effect.logWarning(
                  `Submission outcome unknown, awaiting confirmation: ${name}`,
                ).pipe(
                  Effect.annotateLogs({ op: "postTransactionToChain", txId }),
                ),
                txId,
              )
            : Effect.flatMap(Ref.get(attempts), (n) =>
                Effect.fail(new SubmitError({ txId, attempts: n, cause })),
              ),
        ),
      ),
    );
  });

/** Poll every CONFIRMATION_POLL until the transaction is on chain, under CONFIRMATION_TIMEOUT; each lookup retries retryable provider failures. */
export const awaitConfirmation = (
  txId: TransactionId,
  name: string,
): Effect.Effect<void, SubmitError, Provider | Output> =>
  Effect.gen(function* () {
    const provider = yield* Provider;
    const output = yield* Output;
    const polls = yield* Ref.make(0);
    const poll = Effect.gen(function* () {
      yield* Ref.update(polls, (n) => n + 1);
      const attempts = yield* Ref.make(0);
      const attempt = Effect.gen(function* () {
        const n = yield* Ref.updateAndGet(attempts, (a) => a + 1);
        if (n > 1) {
          yield* output.progress(
            `Awaiting confirmation (attempt ${n}/${MAX_ATTEMPTS}): ${name}`,
          );
        }
        return yield* provider.use("awaitTransactionConfirmation", (p) =>
          p.awaitTransactionConfirmation(txId, 0),
        );
      });
      return yield* attempt.pipe(
        retryNetwork((delay) =>
          Effect.logWarning(
            `Network error during confirmation, retrying in ${Duration.toSeconds(delay)}s...`,
          ).pipe(
            Effect.annotateLogs({
              op: "awaitTransactionConfirmation",
              txId,
              delaySeconds: Duration.toSeconds(delay),
            }),
          ),
        ),
        Effect.catchAll((cause) =>
          Effect.flatMap(Ref.get(attempts), (n) =>
            Effect.fail(new SubmitError({ txId, attempts: n, cause })),
          ),
        ),
      );
    });
    yield* poll.pipe(
      Effect.repeat({
        schedule: Schedule.spaced(CONFIRMATION_POLL),
        until: (confirmed) => confirmed,
      }),
      Effect.timeout(CONFIRMATION_TIMEOUT),
      Effect.catchTag("TimeoutException", () =>
        Effect.flatMap(Ref.get(polls), (n) =>
          Effect.fail(
            new SubmitError({
              txId,
              attempts: n,
              cause: new Error(
                `Transaction ${txId} was not confirmed within ${Duration.toMinutes(CONFIRMATION_TIMEOUT)} minutes`,
              ),
            }),
          ),
        ),
      ),
    );
  });

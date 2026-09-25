/**
 * The Blockfrost REST API: one GET through the platform HttpClient with a
 * timeout, its body decoded through the Schema of the response. A GET is
 * idempotent, so a retryable failure is retried here, never by the caller.
 */
import {
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import {
  Duration,
  Effect,
  Option,
  ParseResult,
  Redacted,
  Schedule,
  type Schema,
} from "effect";
import type { NetworkName } from "@blaze-cardano/query";
import { type ConfigError, ProviderError } from "../errors";
import { Settings } from "../config/settings";
import type { PublicNetwork } from "../config/network-mapping";

/** How long one Blockfrost call may take. */
const BLOCKFROST_TIMEOUT = Duration.seconds(30);

/** The Blockfrost network name of each public Cardano network. */
export const BLOCKFROST_NETWORK: Record<PublicNetwork, NetworkName> = {
  preview: "cardano-preview",
  preprod: "cardano-preprod",
  mainnet: "cardano-mainnet",
};

const baseUrlOf = (host: NetworkName) => `https://${host}.blockfrost.io/api/v0`;

/** An HTTP status worth a retry: rate limited or a server-side failure. */
export const retryableStatus = (status: number) =>
  status === 429 || status >= 500;

const READ_ATTEMPTS = 3;
const READ_RETRY_DELAY = Duration.millis(250);

/** Retry while `retryable` holds: exponential backoff from `base`, `attempts` in total, `announce` with the delay before each retry. */
export const retryBackoff =
  <E>(
    base: Duration.Duration,
    attempts: number,
    retryable: (error: E) => boolean,
    announce: (delay: Duration.Duration) => Effect.Effect<void>,
  ) =>
  <A, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.retry(
      effect,
      Schedule.intersect(
        Schedule.exponential(base),
        Schedule.recurs(attempts - 1),
      ).pipe(
        Schedule.whileInput(retryable),
        Schedule.onDecision(([delay], decision) =>
          decision._tag === "Continue" ? announce(delay) : Effect.void,
        ),
      ),
    );

/** Retry a read while `retryable` holds: backoff from READ_RETRY_DELAY, READ_ATTEMPTS in total, a warning with the op and the delay before each retry. */
export const retryRead = <E>(op: string, retryable: (error: E) => boolean) =>
  retryBackoff(READ_RETRY_DELAY, READ_ATTEMPTS, retryable, (delay) =>
    Effect.logWarning(
      `${op} failed, retrying in ${Duration.format(delay)}`,
    ).pipe(
      Effect.annotateLogs({ op, delaySeconds: Duration.toSeconds(delay) }),
    ),
  );

/** An HttpClient failure as a ProviderError carrying the underlying cause (the request, with its key header, stays out); only a transport failure is retryable. */
const clientFailure =
  (op: string) =>
  (error: HttpClientError.HttpClientError): ProviderError =>
    new ProviderError({
      op,
      cause: error.cause ?? new Error(error.message),
      retryable: error._tag === "RequestError" && error.reason === "Transport",
      reason: error.reason,
    });

/** A body that does not match its schema; the reason is the TreeFormatter message (the op names the path). */
const decodeFailure =
  (op: string) =>
  (cause: ParseResult.ParseError): ProviderError =>
    new ProviderError({
      op,
      cause: new Error(
        `invalid Blockfrost response: ${ParseResult.TreeFormatter.formatErrorSync(cause)}`,
      ),
      retryable: false,
      reason: "Decode",
    });

/** One untraced GET (no span records the key header) under BLOCKFROST_TIMEOUT, retried on a transport failure, a timeout, 429 or 5xx; 404 is None and the body decodes through `schema`. */
export const blockfrostGet = <A, I>(
  baseUrl: string,
  apiKey: Redacted.Redacted,
  path: string,
  schema: Schema.Schema<A, I>,
): Effect.Effect<Option.Option<A>, ProviderError, HttpClient.HttpClient> => {
  const op = `GET ${path}`;
  const request = HttpClientRequest.get(`${baseUrl}${path}`).pipe(
    HttpClientRequest.setHeader("project_id", Redacted.value(apiKey)),
  );
  return Effect.flatMap(HttpClient.HttpClient, (client) =>
    HttpClient.withTracerDisabledWhen(client, () => true)
      .execute(request)
      .pipe(
        Effect.mapError(clientFailure(op)),
        Effect.flatMap((response) =>
          response.status === 404
            ? Effect.succeed(Option.none())
            : response.status < 200 || response.status >= 300
              ? Effect.fail(
                  new ProviderError({
                    op,
                    cause: new Error(`Blockfrost answered ${response.status}`),
                    retryable: retryableStatus(response.status),
                    status: response.status,
                    reason: "StatusCode",
                  }),
                )
              : HttpClientResponse.schemaBodyJson(schema)(response).pipe(
                  Effect.mapError((error) =>
                    ParseResult.isParseError(error)
                      ? decodeFailure(op)(error)
                      : clientFailure(op)(error),
                  ),
                  Effect.map(Option.some),
                ),
        ),
        Effect.timeoutFail({
          duration: BLOCKFROST_TIMEOUT,
          onTimeout: () =>
            new ProviderError({
              op,
              cause: new Error(
                `timed out after ${Duration.format(BLOCKFROST_TIMEOUT)}`,
              ),
              retryable: true,
              reason: "Timeout",
            }),
        }),
        retryRead(op, (error) => error.retryable),
      ),
  );
};

/** What a Blockfrost query needs for an environment. */
export interface BlockfrostAccess {
  readonly cardanoNetwork: PublicNetwork;
  readonly baseUrl: string;
  readonly apiKey: Redacted.Redacted;
}

/** Base URL and API key of a public network. */
export const blockfrostAccessTo = (
  cardanoNetwork: PublicNetwork,
): Effect.Effect<BlockfrostAccess, ConfigError, Settings> =>
  Effect.map(
    Effect.flatMap(Settings, (c) => c.blockfrostApiKey(cardanoNetwork)),
    (apiKey) => ({
      cardanoNetwork,
      baseUrl: baseUrlOf(BLOCKFROST_NETWORK[cardanoNetwork]),
      apiKey,
    }),
  );

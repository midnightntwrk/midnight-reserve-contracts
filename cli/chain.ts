/**
 * The chain: the Provider service over Blockfrost, Kupmios or an emulator,
 * with its named reads, submit and isConfirmed. ProviderConfig, the
 * credentials it connects with, stays inside this module.
 */
import type {
  Address,
  ProtocolParameters,
  RewardAccount,
  Transaction,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import { Unwrapped } from "@blaze-cardano/ogmios";
import {
  Blockfrost,
  Kupmios,
  type Provider as BlazeProvider,
} from "@blaze-cardano/query";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
  Scope,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import {
  DeployerAddress,
  type Environment,
  environmentOf,
  envError,
  Profile,
  requiredSecret,
  requiredString,
  reservedRefs,
  slotConfigOf,
} from "./config";
import {
  BlockfrostUnavailable,
  type ConfigError,
  InputParseError,
  ProviderError,
  UtxoNotFound,
} from "./errors";
import type { TxHash, TxIndex } from "./input";
import type { NamedContract, PlanningContext } from "./tx";

/** A Cardano network Blockfrost serves. */
type PublicNetwork = "preview" | "preprod" | "mainnet";

/** The public network an environment runs on; undefined on local and the emulator. */
const publicNetworkOf = (environment: Environment): PublicNetwork | undefined =>
  environment === "local" || environment === "emulator"
    ? undefined
    : environment === "preprod" || environment === "mainnet"
      ? environment
      : "preview";

/** The chain providers, as `--provider` takes them. */
export const PROVIDERS = ["blockfrost", "emulator", "kupmios"] as const;

export type ProviderType = (typeof PROVIDERS)[number];

/** The variable that holds the Blockfrost API key of a network. */
const blockfrostKeyVariable = (network: PublicNetwork) =>
  `BLOCKFROST_${network.toUpperCase()}_API_KEY`;

/** The provider credentials, read from the environment when asked. */
const ProviderConfig = {
  blockfrostApiKey: (network: PublicNetwork) =>
    requiredSecret(blockfrostKeyVariable(network)),
  kupmios: Effect.all({
    kupoUrl: requiredString("KUPO_URL"),
    ogmiosUrl: requiredString("OGMIOS_URL"),
  }),
};

/** How long one provider call may take. */
const PROVIDER_TIMEOUT = Duration.seconds(30);

/** How long one address read may take, all its pages included (Blaze reads them one at a time). */
const ADDRESS_READ_TIMEOUT = Duration.minutes(5);

/** A call is tried this many times in all; a read's delay doubles from READ_RETRY_DELAY. */
export const ATTEMPTS = 3;
const READ_RETRY_DELAY = Duration.millis(250);

/** An HTTP status worth a retry: rate limited or a server-side failure. */
const retryableStatus = (status: number) => status === 429 || status >= 500;

/** Retry while `retryable` holds, ATTEMPTS in all, the delay doubling from `firstDelay`; `announce` runs with the delay before each retry. */
export const retrying =
  <E>(
    retryable: (error: E) => boolean,
    firstDelay: Duration.Duration,
    announce: (delay: Duration.Duration) => Effect.Effect<void>,
  ) =>
  <A, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      let failures = 0;
      const attempt: Effect.Effect<A, E, R> = Effect.tapError(
        effect,
        (error) => {
          failures += 1;
          return !retryable(error) || failures >= ATTEMPTS
            ? Effect.void
            : announce(Duration.times(firstDelay, 2 ** (failures - 1)));
        },
      );
      return Effect.retry(attempt, {
        times: ATTEMPTS - 1,
        while: retryable,
        schedule: Schedule.exponential(firstDelay),
      });
    });

/** Retry a read while `retryable` holds, with a warning naming the op and the delay before each retry. */
const retryRead = (op: string, retryable: (error: ProviderError) => boolean) =>
  retrying(retryable, READ_RETRY_DELAY, (delay) =>
    Effect.annotateLogs(
      Effect.logWarning(`${op} failed, retrying in ${Duration.format(delay)}`),
      { op, delaySeconds: Duration.toSeconds(delay) },
    ),
  );

/** Fail with a retryable Timeout ProviderError when `effect` takes longer than `timeout`. */
const timeoutAfter =
  (op: string, timeout: Duration.Duration) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.timeoutOrElse(effect, {
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new ProviderError({
            op,
            cause: new Error(`timed out after ${Duration.format(timeout)}`),
            retryable: true,
            reason: "Timeout",
          }),
        ),
    });

/** The part of Blockfrost's `/accounts/{stake_address}` answer read here; a deregistered account also answers, with `registered: false`. */
const BlockfrostAccount = Schema.Struct({ registered: Schema.Boolean });

/** A field of an unknown thrown value, when it has the type `kind`. */
const fieldOf = (value: unknown, field: string, kind: "number" | "string") =>
  typeof value === "object" &&
  value !== null &&
  field in value &&
  typeof (value as Record<string, unknown>)[field] === kind
    ? (value as Record<string, unknown>)[field]
    : undefined;

/**
 * A Blaze provider failure as a ProviderError. An HTTP status (Blaze sets
 * `status` on the error) is retryable on 429 and 5xx; a transport failure
 * (a `code` on the error or its cause) is retryable; anything else is not.
 */
const blazeFailure = (op: string, cause: unknown): ProviderError => {
  const status = fieldOf(cause, "status", "number") as number | undefined;
  if (status !== undefined) {
    return new ProviderError({
      op,
      cause,
      retryable: retryableStatus(status),
      status,
      reason: "StatusCode",
    });
  }
  const transport =
    fieldOf(cause, "code", "string") !== undefined ||
    fieldOf(
      typeof cause === "object" && cause !== null && "cause" in cause
        ? cause.cause
        : undefined,
      "code",
      "string",
    ) !== undefined;
  return new ProviderError({
    op,
    cause,
    retryable: transport,
    ...(transport ? { reason: "Transport" as const } : {}),
  });
};

/** 401 or 403 from Blockfrost: the API key in `variable` was refused. */
const isRefused = (
  error: ConfigError | ProviderError,
): error is ProviderError =>
  error._tag === "ProviderError" &&
  (error.status === 401 || error.status === 403);

const refusedKey = (variable: string, error: ProviderError) =>
  envError(
    variable,
    `Blockfrost refused the API key (HTTP ${error.status}) on ${error.op}`,
  );

/** The service over a Blaze provider that `acquire` connects, on first use and once per run. */
const make = (
  environment: Environment,
  acquire: Effect.Effect<BlazeProvider, ConfigError | ProviderError>,
  /** The variable of the Blockfrost API key the connection uses: a 401 or 403 on a call is a ConfigError naming it. */
  keyVariable: string | undefined,
) =>
  Effect.gen(function* () {
    // One connection for the run: the emulator keeps its ledger, Kupmios keeps one Ogmios socket.
    const connected = yield* Effect.cached(acquire);
    const client = yield* HttpClient.HttpClient;

    /** One call on the connected provider under `timeout`, retried by `retry`, a refused key reported against its variable. */
    const call = <A>(
      op: string,
      run: (provider: BlazeProvider) => Promise<A>,
      timeout: Duration.Duration = PROVIDER_TIMEOUT,
      retry: (
        effect: Effect.Effect<A, ProviderError>,
      ) => Effect.Effect<A, ProviderError> = (effect) => effect,
    ): Effect.Effect<A, ConfigError | ProviderError> =>
      Effect.flatMap(connected, (provider) =>
        retry(
          Effect.tryPromise({
            try: () => run(provider),
            catch: (cause) => blazeFailure(op, cause),
          }).pipe(timeoutAfter(op, timeout)),
        ),
      ).pipe((effect) =>
        keyVariable === undefined
          ? effect
          : Effect.catchIf(effect, isRefused, (error) =>
              Effect.fail(refusedKey(keyVariable, error)),
            ),
      );

    return {
      parameters: call("getParameters", (p) => p.getParameters()),
      unspentOutputs: (address: Address) =>
        call(
          "getUnspentOutputs",
          (p) => p.getUnspentOutputs(address),
          ADDRESS_READ_TIMEOUT,
          (effect) =>
            effect.pipe(
              retryRead(
                "getUnspentOutputs",
                (error) => error.retryable && error.reason !== "Timeout",
              ),
              // Blockfrost's 404 for an address the chain has never seen: that address holds no UTxO.
              Effect.catchIf(
                (error) =>
                  String(error.cause).includes(
                    "The requested component has not been found.",
                  ),
                () => Effect.succeed([]),
              ),
            ),
        ),
      rewardAccountRegistered: (rewardAccount: RewardAccount) => {
        const network = publicNetworkOf(environment);
        if (network === undefined) return Effect.succeedNone;
        const variable = blockfrostKeyVariable(network);
        const op = `GET /accounts/${rewardAccount}`;
        return Effect.gen(function* () {
          const apiKey = yield* ProviderConfig.blockfrostApiKey(network);
          const request = HttpClientRequest.get(
            `https://cardano-${network}.blockfrost.io/api/v0/accounts/${rewardAccount}`,
          ).pipe(
            HttpClientRequest.setHeader("project_id", Redacted.value(apiKey)),
          );
          // One GET: 404 is an account the chain has never seen; a transport failure, a timeout, 429 and 5xx are retried. The request, with its key header, stays out of every error.
          const answer = yield* client.execute(request).pipe(
            Effect.mapError(
              (error) =>
                new ProviderError({
                  op,
                  cause:
                    "cause" in error.reason && error.reason.cause !== undefined
                      ? error.reason.cause
                      : new Error(error.reason._tag),
                  retryable: error.reason._tag === "TransportError",
                  ...(error.reason._tag === "TransportError"
                    ? { reason: "Transport" as const }
                    : {}),
                }),
            ),
            Effect.flatMap((response) =>
              response.status === 404
                ? Effect.succeedNone
                : response.status < 200 || response.status >= 300
                  ? Effect.fail(
                      new ProviderError({
                        op,
                        cause: new Error(
                          `Blockfrost answered ${response.status}`,
                        ),
                        retryable: retryableStatus(response.status),
                        status: response.status,
                        reason: "StatusCode",
                      }),
                    )
                  : response.json.pipe(
                      Effect.flatMap(
                        Schema.decodeUnknownEffect(BlockfrostAccount),
                      ),
                      Effect.mapError(
                        (cause) =>
                          new ProviderError({
                            op,
                            cause: new Error(
                              `invalid Blockfrost response: ${cause.message}`,
                            ),
                            retryable: false,
                            reason: "Decode",
                          }),
                      ),
                      Effect.map(Option.some),
                    ),
            ),
            timeoutAfter(op, PROVIDER_TIMEOUT),
            retryRead(op, (error) => error.retryable),
            Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          );
          return Option.some(Option.exists(answer, (a) => a.registered));
        }).pipe(
          Effect.catchIf(isRefused, (error) =>
            Effect.fail(refusedKey(variable, error)),
          ),
        );
      },
      submit: (tx: Transaction) =>
        call("postTransactionToChain", (p) => p.postTransactionToChain(tx)),
      isConfirmed: (txId: TransactionId) =>
        call("awaitTransactionConfirmation", (p) =>
          p.awaitTransactionConfirmation(txId, 0),
        ),
    };
  });

/** The chain, through named operations only. Every call fails with a ProviderError (`retryable` per its failure) or a ConfigError for missing or refused credentials. */
export class Provider extends Context.Service<
  Provider,
  {
    /** The protocol parameters, read on each call. */
    readonly parameters: Effect.Effect<
      ProtocolParameters,
      ConfigError | ProviderError
    >;
    /** Every UTxO at an address, under ADDRESS_READ_TIMEOUT, retried on a retryable failure other than that timeout. */
    readonly unspentOutputs: (
      address: Address,
    ) => Effect.Effect<TransactionUnspentOutput[], ConfigError | ProviderError>;
    /** Whether Blockfrost reports the reward account registered, on any provider of a public network; None on local and the emulator. */
    readonly rewardAccountRegistered: (
      rewardAccount: RewardAccount,
    ) => Effect.Effect<Option.Option<boolean>, ConfigError | ProviderError>;
    /** Post a signed transaction once (no retry). */
    readonly submit: (
      tx: Transaction,
    ) => Effect.Effect<TransactionId, ConfigError | ProviderError>;
    /** One lookup, no wait: whether the transaction is on chain. */
    readonly isConfirmed: (
      txId: TransactionId,
    ) => Effect.Effect<boolean, ConfigError | ProviderError>;
  }
>()("cli/Provider") {
  /**
   * The provider of an environment: `providerType`, or by default the
   * emulator on the emulator, Kupmios on local and Blockfrost on a public
   * network. Blockfrost off a public network fails the layer; the
   * connection opens on first use, and an Ogmios socket closes with the
   * layer.
   */
  static readonly layer = (
    environment: Environment,
    providerType?: ProviderType,
  ) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const type =
          providerType ??
          (environment === "emulator"
            ? "emulator"
            : environment === "local"
              ? "kupmios"
              : "blockfrost");
        const network = publicNetworkOf(environment);
        if (type === "blockfrost" && network === undefined) {
          return yield* new BlockfrostUnavailable({ environment });
        }
        const scope = yield* Effect.scope;
        const connect: Effect.Effect<
          BlazeProvider,
          ConfigError | ProviderError,
          Scope.Scope
        > =
          type === "emulator"
            ? Effect.sync(() => new EmulatorProvider(new Emulator([])))
            : type === "blockfrost" && network !== undefined
              ? Effect.map(
                  ProviderConfig.blockfrostApiKey(network),
                  (projectId) =>
                    new Blockfrost({
                      network: `cardano-${network}`,
                      projectId: Redacted.value(projectId),
                    }),
                )
              : Effect.gen(function* () {
                  const { kupoUrl, ogmiosUrl } = yield* ProviderConfig.kupmios;
                  const ogmios = yield* Effect.acquireRelease(
                    Effect.tryPromise({
                      try: () => Unwrapped.Ogmios.new(ogmiosUrl),
                      // A failed connect is final: the run keeps one connection, so a retry would see the same failure.
                      catch: (cause) =>
                        new ProviderError({
                          op: "Ogmios.new",
                          cause,
                          retryable: false,
                        }),
                    }),
                    // kill() closes the socket and resolves on its close event. An Ogmios that never answers the close frame leaves ws's 30 s close timer running, which keeps the process alive, so after 5 s the socket is terminated.
                    (client) =>
                      Effect.tryPromise(() => client.kill()).pipe(
                        Effect.orDie,
                        Effect.timeoutOrElse({
                          duration: Duration.seconds(5),
                          orElse: () =>
                            Effect.sync(() => client.connect().terminate()),
                        }),
                      ),
                  );
                  return new Kupmios(kupoUrl, ogmios);
                });
        return yield* make(
          environment,
          Effect.provideService(connect, Scope.Scope, scope),
          type === "blockfrost" && network !== undefined
            ? blockfrostKeyVariable(network)
            : undefined,
        );
      }),
    );

  /** The service over a given Blaze provider, an emulator in tests. */
  static readonly over = (
    provider: BlazeProvider,
    environment: Environment = "emulator",
  ) =>
    Layer.effect(this, make(environment, Effect.succeed(provider), undefined));
}

/**
 * The PlanningContext of a command: the protocol parameters, the wallet's
 * address and its UTxOs, the profile's reserved UTxO references, the slot
 * configuration and network of the environment, the contracts that name
 * validators in traces, and the command's own resolved inputs. Every chain
 * read a plan needs happens here or before; compile reads none.
 */
export const planningContext = <Resolved>(options: {
  readonly command: string;
  readonly environment: Environment;
  readonly wallet: Address;
  readonly contracts: readonly NamedContract[];
  readonly resolved: Resolved;
}): Effect.Effect<
  PlanningContext<Resolved>,
  ConfigError | ProviderError,
  Provider | Profile
> =>
  Effect.gen(function* () {
    const provider = yield* Provider;
    const parameters = yield* provider.parameters;
    const utxos = yield* provider.unspentOutputs(options.wallet);
    const config = yield* (yield* Profile).config;
    return {
      command: options.command,
      networkId: environmentOf(options.environment).networkId,
      slotConfig: slotConfigOf(options.environment),
      parameters,
      wallet: { address: options.wallet, utxos },
      reserved: reservedRefs(config),
      contracts: options.contracts,
      resolved: options.resolved,
    };
  });

/** The deployer's address and its UTxO with this reference, which must carry no reference script. */
export const deployerUtxo = (txHash: TxHash, txIndex: TxIndex) =>
  Effect.gen(function* () {
    const address = yield* (yield* DeployerAddress).address;
    const utxos = yield* (yield* Provider).unspentOutputs(address);
    const utxo = utxos.find(
      (u) =>
        String(u.input().transactionId()) === txHash &&
        u.input().index() === BigInt(txIndex),
    );
    if (utxo === undefined) {
      return yield* UtxoNotFound.byRef(
        `${txHash}#${txIndex}`,
        address.toBech32(),
      );
    }
    const script = utxo.output().scriptRef();
    if (script !== undefined) {
      return yield* new InputParseError({
        source: "--tx-hash/--tx-index",
        issues: [
          `${txHash}#${txIndex} carries reference script ${script.hash()}; the CLI never spends a reference script, so pick another fee UTxO`,
        ],
      });
    }
    return { address, utxo };
  });

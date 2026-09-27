/**
 * Chain providers: Blockfrost, Kupmios or an emulator, and a Blaze instance
 * over one.
 */
import { Address, type TransactionUnspentOutput } from "@blaze-cardano/core";
import {
  Blaze,
  ColdWallet,
  type Provider as BlazeProvider,
} from "@blaze-cardano/sdk";
import { Blockfrost, Kupmios } from "@blaze-cardano/query";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import { Unwrapped } from "@blaze-cardano/ogmios";
import {
  Context,
  Duration,
  Effect,
  Either,
  Layer,
  Option,
  Redacted,
  Scope,
} from "effect";
import {
  type Environment,
  type ProviderType,
  type PublicNetwork,
  defaultProviderFor,
  environmentOf,
  publicNetworkOf,
} from "../config/network-mapping";
import { Settings } from "../config/settings";
import { BlockfrostUnavailable, ConfigError, ProviderError } from "../errors";
import { BLOCKFROST_NETWORK, retryableStatus, retryRead } from "./blockfrost";

/** What a provider connects to: its type, and for Blockfrost the Cardano network, checked where the layer is built. */
type Connection =
  | { readonly type: "emulator" | "kupmios" }
  | { readonly type: "blockfrost"; readonly cardanoNetwork: PublicNetwork };

const connectionFor = (
  environment: Environment,
  providerType?: ProviderType,
): Either.Either<Connection, BlockfrostUnavailable> => {
  const type =
    providerType ??
    defaultProviderFor(environmentOf(environment).cardanoNetwork);
  return type === "blockfrost"
    ? Either.fromOption(
        Option.map(publicNetworkOf(environment), (cardanoNetwork) => ({
          type,
          cardanoNetwork,
        })),
        () => new BlockfrostUnavailable({ environment }),
      )
    : Either.right({ type });
};

/** A failed connect is final: the connection is cached, so a retry would see the same failure. */
const connectFailure = (op: string) => (cause: unknown) =>
  new ProviderError({ op, cause, retryable: false });

/** The Settings reads a provider's credentials need. */
type Credentials = Pick<
  Context.Tag.Service<Settings>,
  "blockfrostApiKey" | "kupmios"
>;

const connect = (
  connection: Connection,
  credentials: Credentials,
): Effect.Effect<BlazeProvider, ConfigError | ProviderError, Scope.Scope> => {
  switch (connection.type) {
    case "emulator":
      return Effect.sync(() => new EmulatorProvider(new Emulator([])));
    case "blockfrost":
      return Effect.gen(function* () {
        const { cardanoNetwork } = connection;
        const projectId = yield* credentials.blockfrostApiKey(cardanoNetwork);
        return new Blockfrost({
          network: BLOCKFROST_NETWORK[cardanoNetwork],
          projectId: Redacted.value(projectId),
        });
      });
    case "kupmios":
      return Effect.gen(function* () {
        const { kupoUrl, ogmiosUrl } = yield* credentials.kupmios;
        const ogmios = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => Unwrapped.Ogmios.new(ogmiosUrl),
            catch: connectFailure("Ogmios.new"),
          }),
          // kill() never resolves on an open socket; close the socket itself.
          (client) => Effect.sync(() => client.connect().close()),
        );
        return new Kupmios(kupoUrl, ogmios);
      });
  }
};

/** The deployer's cold wallet; coin selection never sees a UTxO that carries a reference script, so the bridge reference scripts at the deployer address stay unspent. */
class DeployerWallet extends ColdWallet {
  override async getUnspentOutputs(): Promise<TransactionUnspentOutput[]> {
    return (await super.getUnspentOutputs()).filter(
      (utxo) => utxo.output().scriptRef() === undefined,
    );
  }
}

/** A Blaze instance over the provider with the deployer's cold wallet. */
type DeployerBlaze = Blaze<BlazeProvider, DeployerWallet>;

/** A chain provider; every call is an Effect failing with ProviderError. */
export class Provider extends Context.Tag("cli/Provider")<
  Provider,
  {
    /** Run one provider call under PROVIDER_TIMEOUT; `op` names it in the error, whose `retryable` follows the failure's shape. */
    readonly use: <A>(
      op: string,
      f: (provider: BlazeProvider) => Promise<A>,
    ) => Effect.Effect<A, ProviderError | ConfigError>;
    /** Every UTxO at an address, under ADDRESS_READ_TIMEOUT (Blaze reads it one page at a time), retried on a retryable failure other than that timeout. */
    readonly unspentOutputs: (
      address: Address,
    ) => Effect.Effect<TransactionUnspentOutput[], ProviderError | ConfigError>;
    /** Blaze over the provider with the deployer's cold wallet (Settings.deployerAddress), built once. */
    readonly blaze: Effect.Effect<
      DeployerBlaze,
      ProviderError | ConfigError,
      Settings
    >;
  }
>() {}

/** A report that reads the chain runs only on a public network; local and the emulator are refused. */
export const requireOnChainNetwork = (environment: Environment) =>
  Either.fromOption(
    publicNetworkOf(environment),
    () =>
      new ConfigError({
        source: "env",
        key: "--network",
        reason: `Cannot query on-chain data for environment '${environment}'. Use a real network like preview, preprod, or mainnet.`,
      }),
  );

/** How long one provider call may take. */
const PROVIDER_TIMEOUT = Duration.seconds(30);

/** Blockfrost's 404 message, which Blaze passes on for an address the chain has never seen: that address holds no UTxO. */
const unseenAddress = (error: ProviderError) =>
  String(error.cause).includes("The requested component has not been found.");

/** How long one address read may take, all its pages included. */
const ADDRESS_READ_TIMEOUT = Duration.minutes(5);

const codeOf = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  typeof value.code === "string"
    ? value.code
    : undefined;

const statusOf = (value: unknown): number | undefined =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  typeof value.status === "number"
    ? value.status
    : undefined;

/** A Blaze failure as a ProviderError: an HTTP status follows retryableStatus, a transport error (a `code` on the cause or its cause) is retryable, anything else is not. */
const providerFailure = (op: string, cause: unknown): ProviderError => {
  const status = statusOf(cause);
  if (status !== undefined) {
    return new ProviderError({
      op,
      cause,
      retryable: retryableStatus(status),
      status,
      reason: "StatusCode",
    });
  }
  const nested =
    typeof cause === "object" && cause !== null && "cause" in cause
      ? cause.cause
      : undefined;
  return codeOf(cause) !== undefined || codeOf(nested) !== undefined
    ? new ProviderError({ op, cause, retryable: true, reason: "Transport" })
    : new ProviderError({ op, cause, retryable: false });
};

/** Run a promise-returning provider call under `timeout`, its failure classified; a timeout is retryable. */
const providerCall = <A>(
  op: string,
  run: () => Promise<A>,
  timeout: Duration.Duration = PROVIDER_TIMEOUT,
) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => providerFailure(op, cause),
  }).pipe(
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () =>
        new ProviderError({
          op,
          cause: new Error(`timed out after ${Duration.format(timeout)}`),
          retryable: true,
          reason: "Timeout",
        }),
    }),
  );

const providerService = (
  environment: Environment,
  acquire: Effect.Effect<BlazeProvider, ProviderError | ConfigError>,
) =>
  Effect.gen(function* () {
    const cached = yield* Effect.cached(acquire);
    const blaze = yield* Effect.cached(
      Effect.gen(function* () {
        const provider = yield* cached;
        const config = yield* Settings;
        const deployerAddress = yield* config.deployerAddress;
        const { networkId } = environmentOf(environment);
        const wallet = new DeployerWallet(deployerAddress, networkId, provider);
        return yield* providerCall("Blaze.from", () =>
          Blaze.from(provider, wallet),
        );
      }),
    );
    return {
      use: <A>(op: string, f: (provider: BlazeProvider) => Promise<A>) =>
        Effect.flatMap(cached, (provider) =>
          providerCall(op, () => f(provider)),
        ),
      unspentOutputs: (address: Address) =>
        Effect.flatMap(cached, (provider) =>
          providerCall(
            "getUnspentOutputs",
            () => provider.getUnspentOutputs(address),
            ADDRESS_READ_TIMEOUT,
          ).pipe(
            retryRead(
              "getUnspentOutputs",
              (error) => error.retryable && error.reason !== "Timeout",
            ),
            Effect.catchIf(unseenAddress, () => Effect.succeed([])),
          ),
        ),
      blaze,
    };
  });

/** Provider for the environment (Blockfrost, Kupmios or emulator), credentials from Settings; Blockfrost off a Cardano network fails the layer, a connection is made on first use, and an Ogmios socket closes with the layer. */
export const ProviderLive = (
  environment: Environment,
  providerType?: ProviderType,
) =>
  Layer.scoped(
    Provider,
    Effect.gen(function* () {
      const connection = yield* connectionFor(environment, providerType);
      const scope = yield* Effect.scope;
      const config = yield* Settings;
      return yield* providerService(
        environment,
        Scope.extend(connect(connection, config), scope),
      );
    }),
  );

/** Provider over a given Blaze provider (tests: an emulator). */
export const ProviderOver = (
  provider: BlazeProvider,
  environment: Environment = "emulator",
) =>
  Layer.effect(
    Provider,
    providerService(environment, Effect.succeed(provider)),
  );

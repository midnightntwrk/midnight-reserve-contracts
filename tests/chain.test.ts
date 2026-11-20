import {
  CredentialType,
  Hash28ByteBase16,
  NetworkId,
  RewardAccount,
  type Transaction,
  type TransactionUnspentOutput,
  Value,
} from "@blaze-cardano/core";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { Provider } from "../cli/chain";
import type { Environment } from "../cli/config";
import { renderError } from "../cli/errors";

const KEY = "preview-project-id-secret";
const ACCOUNT = RewardAccount.fromCredential(
  {
    type: CredentialType.ScriptHash,
    hash: Hash28ByteBase16("ab".repeat(28)),
  },
  NetworkId.Testnet,
);

/** What the fake Blockfrost answers to one request: an HTTP status with a JSON body, or a refused connection. */
type Answer = { readonly status: number; readonly body?: unknown } | "refused";

/** An HttpClient that records each request and gives the answers in order, the last one again once they run out. */
const fakeBlockfrost = (answers: readonly Answer[]) => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const layer = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      requests.push(request);
      const answer = answers[Math.min(requests.length, answers.length) - 1];
      return answer === "refused"
        ? Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                cause: Object.assign(new Error("connect ECONNREFUSED"), {
                  code: "ECONNREFUSED",
                }),
              }),
            }),
          )
        : Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify(answer.body ?? {}), {
                status: answer.status,
              }),
            ),
          );
    }),
  );
  return { requests, layer };
};

/** The registration read on `environment` with Blockfrost answering `answers`, and the requests it makes. */
const registration = (
  answers: readonly Answer[],
  env: Record<string, string> = { BLOCKFROST_PREVIEW_API_KEY: KEY },
  environment: Environment = "preview",
) => {
  const blockfrost = fakeBlockfrost(answers);
  const read = Effect.provide(
    Effect.flatMap(Provider, (provider) =>
      provider.rewardAccountRegistered(ACCOUNT),
    ),
    Layer.mergeAll(
      Layer.provide(
        Provider.layer(environment, "blockfrost"),
        blockfrost.layer,
      ),
      ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
    ),
  );
  return { read, requests: blockfrost.requests };
};

describe("Blockfrost reward-account read", () => {
  it.live("asks Blockfrost with the network's API key", () =>
    Effect.gen(function* () {
      const { read, requests } = registration([
        { status: 200, body: { registered: true } },
      ]);
      expect(yield* read).toEqual(Option.some(true));
      expect(requests.map((r) => r.url)).toEqual([
        `https://cardano-preview.blockfrost.io/api/v0/accounts/${ACCOUNT}`,
      ]);
      expect(requests[0].headers.project_id).toBe(KEY);
    }),
  );

  it.live(
    "an account the chain has never seen (404) or deregistered is not registered",
    () =>
      Effect.gen(function* () {
        for (const answer of [
          { status: 404 },
          { status: 200, body: { registered: false } },
        ]) {
          expect(yield* registration([answer]).read).toEqual(
            Option.some(false),
          );
        }
      }),
  );

  it.live.each([401, 403])(
    "HTTP %s is a ConfigError on the key variable, at once",
    (status) =>
      Effect.gen(function* () {
        const { read, requests } = registration(
          [{ status }],
          { BLOCKFROST_PREVIEW_API_KEY: KEY },
          "qanet",
        );
        const error = yield* Effect.flip(read);
        expect(requests).toHaveLength(1);
        expect(error).toMatchObject({
          _tag: "ConfigError",
          key: "BLOCKFROST_PREVIEW_API_KEY",
          reason: `Blockfrost refused the API key (HTTP ${status}) on GET /accounts/${ACCOUNT}`,
        });
      }),
  );

  it.live(
    "429 and 5xx are retried after a real delay, 250 ms then 500 ms",
    () =>
      Effect.gen(function* () {
        const started = Date.now();
        const { read, requests } = registration([
          { status: 429 },
          { status: 503 },
          { status: 200, body: { registered: true } },
        ]);
        expect(yield* read).toEqual(Option.some(true));
        expect(requests).toHaveLength(3);
        expect(Date.now() - started).toBeGreaterThanOrEqual(700);
      }),
  );

  it.live("three 5xx answers fail after three requests, the key unquoted", () =>
    Effect.gen(function* () {
      const { read, requests } = registration([{ status: 500 }]);
      const error = yield* Effect.flip(read);
      expect(requests).toHaveLength(3);
      expect(error).toMatchObject({
        _tag: "ProviderError",
        status: 500,
        retryable: true,
      });
      expect(renderError(error)).not.toContain(KEY);
    }),
  );

  it.live(
    "a refused connection is a retryable transport failure, tried three times",
    () =>
      Effect.gen(function* () {
        const { read, requests } = registration(["refused"]);
        const error = yield* Effect.flip(read);
        expect(requests).toHaveLength(3);
        expect(error).toMatchObject({
          _tag: "ProviderError",
          reason: "Transport",
          retryable: true,
        });
        expect(renderError(error)).toContain("ECONNREFUSED");
      }),
  );

  it.live("a body without `registered` is a Decode failure, not retried", () =>
    Effect.gen(function* () {
      const { read, requests } = registration([
        { status: 200, body: { stake_address: "x" } },
      ]);
      expect(yield* Effect.flip(read)).toMatchObject({
        _tag: "ProviderError",
        reason: "Decode",
        retryable: false,
      });
      expect(requests).toHaveLength(1);
    }),
  );

  it.live("an unset API key is a ConfigError, with no request", () =>
    Effect.gen(function* () {
      const { read, requests } = registration([{ status: 200 }], {});
      expect(yield* Effect.flip(read)).toMatchObject({
        _tag: "ConfigError",
        key: "BLOCKFROST_PREVIEW_API_KEY",
        reason: "required but not set",
      });
      expect(requests).toEqual([]);
    }),
  );

  it.live("the emulator has no registration to read", () =>
    Effect.gen(function* () {
      const blockfrost = fakeBlockfrost([{ status: 500 }]);
      const answer = yield* Effect.provide(
        Effect.flatMap(Provider, (provider) =>
          provider.rewardAccountRegistered(ACCOUNT),
        ),
        Layer.provide(Provider.layer("emulator"), blockfrost.layer),
      );
      expect(answer).toEqual(Option.none());
      expect(blockfrost.requests).toEqual([]);
    }),
  );

  it.live("Blockfrost on local fails the layer", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(registration([], {}, "local").read);
      expect(error).toMatchObject({
        _tag: "BlockfrostUnavailable",
        environment: "local",
      });
    }),
  );
});

/** An emulator whose address reads fail with `failures` in turn before they answer. */
class FailingReads extends EmulatorProvider {
  calls = 0;
  constructor(private readonly failures: readonly unknown[]) {
    super(new Emulator([]));
  }
  override getUnspentOutputs(
    ...args: Parameters<EmulatorProvider["getUnspentOutputs"]>
  ): Promise<TransactionUnspentOutput[]> {
    const failure = this.failures[this.calls++];
    return failure === undefined
      ? super.getUnspentOutputs(...args)
      : Promise.reject(failure);
  }
}

/** The deployer's UTxOs read through the Provider over `provider`. */
const readAddress = (provider: FailingReads) =>
  Effect.provide(
    Effect.flatMap(Provider, (p) =>
      Effect.flatMap(
        Effect.promise(() =>
          new Emulator([]).register("reader", new Value(5_000_000n)),
        ),
        (address) => p.unspentOutputs(address),
      ),
    ),
    Layer.provide(Provider.over(provider), fakeBlockfrost([]).layer),
  );

const statusError = (status: number) =>
  Object.assign(new Error(`request failed with status ${status}`), { status });

describe("Provider reads through Blaze", () => {
  it.live("a 503 and a transport failure are retried", () =>
    Effect.gen(function* () {
      const provider = new FailingReads([
        statusError(503),
        Object.assign(new Error("fetch failed"), {
          cause: { code: "ECONNRESET" },
        }),
      ]);
      expect(yield* readAddress(provider)).toEqual([]);
      expect(provider.calls).toBe(3);
    }),
  );

  it.live("a 401 fails at once", () =>
    Effect.gen(function* () {
      const provider = new FailingReads([statusError(401)]);
      const error = yield* Effect.flip(readAddress(provider));
      expect(provider.calls).toBe(1);
      expect(error).toMatchObject({
        _tag: "ProviderError",
        status: 401,
        retryable: false,
      });
    }),
  );

  it.live("Blockfrost's 404 for an unseen address is an empty address", () =>
    Effect.gen(function* () {
      const provider = new FailingReads([
        new Error("The requested component has not been found."),
      ]);
      expect(yield* readAddress(provider)).toEqual([]);
      expect(provider.calls).toBe(1);
    }),
  );
});

describe("submission on the emulator", () => {
  /** An emulator with a funded wallet, the Provider over it, and a transaction paying 5 ADA back to the wallet, signed or not. */
  const setup = Effect.promise(async () => {
    const emulator = new Emulator([]);
    await emulator.register("alice", new Value(100_000_000n));
    const transaction = (sign: boolean) =>
      emulator.as("alice", async (blaze, address): Promise<Transaction> => {
        const tx = await blaze
          .newTransaction()
          .payLovelace(address, 5_000_000n)
          .complete();
        return sign ? blaze.signTransaction(tx) : tx;
      });
    return {
      layer: Layer.provide(
        Provider.over(new EmulatorProvider(emulator)),
        fakeBlockfrost([]).layer,
      ),
      signed: await transaction(true),
      unsigned: await transaction(false),
    };
  });

  it.live("a signed transaction is submitted and then on chain", () =>
    Effect.gen(function* () {
      const { layer, signed } = yield* setup;
      const onChain = yield* Effect.provide(
        Effect.gen(function* () {
          const provider = yield* Provider;
          expect(yield* provider.isConfirmed(signed.getId())).toBe(false);
          expect(yield* provider.submit(signed)).toBe(signed.getId());
          return yield* provider.isConfirmed(signed.getId());
        }),
        layer,
      );
      expect(onChain).toBe(true);
    }),
  );

  it.live(
    "an unsigned transaction is refused and never counts as on chain",
    () =>
      Effect.gen(function* () {
        const { layer, unsigned } = yield* setup;
        const { error, onChain } = yield* Effect.provide(
          Effect.gen(function* () {
            const provider = yield* Provider;
            return {
              error: yield* Effect.flip(provider.submit(unsigned)),
              onChain: yield* provider.isConfirmed(unsigned.getId()),
            };
          }),
          layer,
        );
        expect(error).toMatchObject({
          _tag: "ProviderError",
          op: "postTransactionToChain",
          retryable: false,
        });
        expect(onChain).toBe(false);
      }),
  );
});

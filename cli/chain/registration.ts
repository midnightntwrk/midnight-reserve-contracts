/** Reward-account registration, read from Blockfrost. */
import type { RewardAccount } from "@blaze-cardano/core";
import type { HttpClient } from "@effect/platform";
import { Effect, Option, Schema } from "effect";
import { type Environment, publicNetworkOf } from "../config/network-mapping";
import type { ProviderConfig } from "../config/provider-config";
import { blockfrostApiKeyVariable } from "../config/provider-config";
import { blockfrostAccessTo, blockfrostGet } from "./blockfrost";
import { ConfigError, type ProviderError, StakeNotRegistered } from "../errors";

/** The part of Blockfrost's `/accounts/{stake_address}` answer read here; a deregistered account also answers, with `registered: false`. */
const BlockfrostAccount = Schema.Struct({ registered: Schema.Boolean });

/** Whether Blockfrost reports a reward account registered; None where no chain can be queried (local, emulator). */
export const registrationOnChain = (
  rewardAccount: RewardAccount,
  environment: Environment,
): Effect.Effect<
  Option.Option<boolean>,
  ConfigError | ProviderError,
  ProviderConfig | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const network = publicNetworkOf(environment);
    if (Option.isNone(network)) return Option.none();
    const access = yield* blockfrostAccessTo(network.value);
    const account = yield* blockfrostGet(
      access.baseUrl,
      access.apiKey,
      `/accounts/${rewardAccount}`,
      BlockfrostAccount,
    ).pipe(
      Effect.catchIf(
        (error) => error.status === 401 || error.status === 403,
        (error) =>
          Effect.fail(
            new ConfigError({
              source: "env",
              key: blockfrostApiKeyVariable(access.cardanoNetwork),
              reason: `Blockfrost auth error (${error.status}) checking reward account ${rewardAccount}`,
            }),
          ),
      ),
    );
    return Option.some(Option.exists(account, (a) => a.registered));
  });

/** Whether a reward account is registered on chain; local and emulator count as registered. */
export const rewardAccountRegistered = (
  rewardAccount: RewardAccount,
  environment: Environment,
): Effect.Effect<
  boolean,
  ConfigError | ProviderError,
  ProviderConfig | HttpClient.HttpClient
> =>
  Effect.map(
    registrationOnChain(rewardAccount, environment),
    Option.getOrElse(() => true),
  );

/** Every account must be registered; the failure lists the ones that are not. */
export const ensureRegistered = (
  accounts: readonly {
    label: string;
    rewardAccount: RewardAccount;
    scriptHash: string;
  }[],
  environment: Environment,
): Effect.Effect<
  void,
  ConfigError | ProviderError | StakeNotRegistered,
  ProviderConfig | HttpClient.HttpClient
> =>
  Effect.flatMap(
    Effect.all(
      accounts.map((account) =>
        Effect.map(
          rewardAccountRegistered(account.rewardAccount, environment),
          (registered) => ({
            ...account,
            registered,
          }),
        ),
      ),
      { concurrency: "unbounded" },
    ),
    (results) => {
      const unregistered = results.filter((r) => !r.registered);
      return unregistered.length === 0
        ? Effect.void
        : Effect.fail(
            new StakeNotRegistered({ environment, accounts: unregistered }),
          );
    },
  );

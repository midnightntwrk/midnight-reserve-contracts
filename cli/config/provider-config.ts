/** The credentials a chain provider connects with: the Blockfrost API key of a Cardano network, and the Kupo and Ogmios URLs. */
import { Context, Effect, Layer, type Redacted } from "effect";
import type { ConfigError } from "../errors";
import { requiredSecret, requiredString } from "./env";
import type { PublicNetwork } from "./network-mapping";

/** The variable that holds the Blockfrost API key of a Cardano network. */
export const blockfrostApiKeyVariable = (network: PublicNetwork) =>
  `BLOCKFROST_${network.toUpperCase()}_API_KEY`;

/** Provider credentials, each read from the environment when asked. */
export class ProviderConfig extends Context.Tag("cli/ProviderConfig")<
  ProviderConfig,
  {
    /** BLOCKFROST_<NETWORK>_API_KEY of a Cardano network. */
    readonly blockfrostApiKey: (
      network: PublicNetwork,
    ) => Effect.Effect<Redacted.Redacted, ConfigError>;
    /** KUPO_URL and OGMIOS_URL. */
    readonly kupmios: Effect.Effect<
      { readonly kupoUrl: string; readonly ogmiosUrl: string },
      ConfigError
    >;
  }
>() {}

export const ProviderConfigLive = Layer.succeed(ProviderConfig, {
  blockfrostApiKey: (network) =>
    requiredSecret(blockfrostApiKeyVariable(network)),
  kupmios: Effect.all({
    kupoUrl: requiredString("KUPO_URL"),
    ogmiosUrl: requiredString("OGMIOS_URL"),
  }),
});

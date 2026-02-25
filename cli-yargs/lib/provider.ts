import { Address } from "@blaze-cardano/core";
import { Blaze, ColdWallet, type Provider } from "@blaze-cardano/sdk";
import { Blockfrost, Kupmios, type NetworkName } from "@blaze-cardano/query";
import { Emulator } from "@blaze-cardano/emulator";
import type { ProviderType } from "./types";
import { Unwrapped } from "@blaze-cardano/ogmios";
import { getNetworkId, getDefaultProvider, getCardanoNetwork } from "./types";
import { getEnvVar, getDeployerAddress } from "./config";

export async function createProvider(
  environment: string,
  providerType?: ProviderType,
): Promise<Provider> {
  const type = providerType || getDefaultProvider(environment);

  switch (type) {
    case "emulator":
      return new Emulator([]) as unknown as Provider;

    case "blockfrost": {
      const cardanoNetwork = getCardanoNetwork(environment);

      if (cardanoNetwork === null) {
        throw new Error(
          `Blockfrost provider requires a real Cardano network (preview/preprod/mainnet). ` +
            `Environment '${environment}' maps to local/emulator. Use --provider emulator instead.`,
        );
      }

      const apiKeyVar = `BLOCKFROST_${cardanoNetwork.toUpperCase()}_API_KEY`;
      const apiKey = getEnvVar(apiKeyVar);

      const networkNameMap: Record<string, NetworkName> = {
        preview: "cardano-preview",
        preprod: "cardano-preprod",
        mainnet: "cardano-mainnet",
      };

      return new Blockfrost({
        network: networkNameMap[cardanoNetwork],
        projectId: apiKey,
      });
    }

    case "maestro":
      throw new Error(
        "Maestro provider is not currently available in @blaze-cardano/query. " +
          "Please use --provider blockfrost or --provider kupmios instead.",
      );

    case "kupmios": {
      const kupoUrl = getEnvVar("KUPO_URL");
      const ogmiosUrl = getEnvVar("OGMIOS_URL");
      const ogmios = await Unwrapped.Ogmios.new(ogmiosUrl);
      return new Kupmios(kupoUrl, ogmios);
    }

    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

export async function createBlaze(
  environment: string,
  providerType?: ProviderType,
): Promise<{ blaze: Blaze<Provider, ColdWallet>; provider: Provider }> {
  const provider = await createProvider(environment, providerType);
  const networkId = getNetworkId(environment);
  const deployerAddress = getDeployerAddress(environment);
  const address = Address.fromBech32(deployerAddress);
  const wallet = new ColdWallet(address, networkId, provider);
  const blaze = await Blaze.from(provider, wallet);

  return { blaze, provider };
}

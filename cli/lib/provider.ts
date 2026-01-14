import { Address } from "@blaze-cardano/core";
import { Blaze, ColdWallet, type Provider } from "@blaze-cardano/sdk";
import { Blockfrost, Kupmios, type NetworkName } from "@blaze-cardano/query";
import { Maestro } from "@blaze-cardano/query";
import { Emulator } from "@blaze-cardano/emulator";
import type { Network, ProviderType } from "./types";
import { Unwrapped } from "@blaze-cardano/ogmios";
import { getNetworkId, getDefaultProvider } from "./types";
import { getEnvVar, getDeployerAddress } from "./config";

export async function createProvider(
  network: Network,
  providerType?: ProviderType,
): Promise<Provider> {
  const type = providerType || getDefaultProvider(network);

  switch (type) {
    case "emulator":
      return new Emulator([]) as unknown as Provider;

    case "blockfrost": {
      const apiKeyVar = `BLOCKFROST_${network.toUpperCase()}_API_KEY`;
      const apiKey = getEnvVar(apiKeyVar);

      const networkNameMap: Record<Network, NetworkName> = {
        local: "cardano-preview", // fallback for local
        preview: "cardano-preview",
        preprod: "cardano-preprod",
        mainnet: "cardano-mainnet",
      };

      return new Blockfrost({
        network: networkNameMap[network],
        projectId: apiKey,
      });
    }

    case "maestro": {
      const apiKeyVar = `MAESTRO_${network.toUpperCase()}_API_KEY`;
      const apiKey = getEnvVar(apiKeyVar);

      if (network === "local") {
        throw new Error("Maestro provider does not support local network");
      }

      return new Maestro({
        network: network,
        apiKey: apiKey,
      });
    }

    case "kupmios": {
      const kupoUrl = getEnvVar("KUPO_URL");
      const ogmiosUrl = getEnvVar("OGMIOS_URL");
      if (!kupoUrl || !ogmiosUrl) {
        throw new Error("Both KUPO_URL and OGMIOS_URL environment variables must be set for kupmios provider");
      }
      const ogmios = await Unwrapped.Ogmios.new(ogmiosUrl);
      return new Kupmios(kupoUrl, ogmios);
    }

    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

export async function createBlaze(
  network: Network,
  providerType?: ProviderType,
): Promise<{ blaze: Blaze<Provider, ColdWallet>; provider: Provider }> {
  const provider = await createProvider(network, providerType);
  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const address = Address.fromBech32(deployerAddress);
  const wallet = new ColdWallet(address, networkId, provider);
  const blaze = await Blaze.from(provider, wallet);

  return { blaze, provider };
}

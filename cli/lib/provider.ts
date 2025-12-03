import { Address, NetworkId } from "@blaze-cardano/core";
import { Blaze, ColdWallet, type Provider } from "@blaze-cardano/sdk";
import { Blockfrost } from "@blaze-cardano/query";
import { Maestro } from "@blaze-cardano/query";
import { Emulator } from "@blaze-cardano/emulator";
import type { Network, ProviderType } from "./types";
import { getNetworkId, getDefaultProvider } from "./types";
import { getEnvVar, getDeployerAddress } from "./config";

export function createProvider(
  network: Network,
  providerType?: ProviderType,
): Provider {
  const type = providerType || getDefaultProvider(network);

  switch (type) {
    case "emulator":
      return new Emulator([]);

    case "blockfrost": {
      const apiKeyVar = `BLOCKFROST_${network.toUpperCase()}_API_KEY`;
      const apiKey = getEnvVar(apiKeyVar);

      const networkNameMap: Record<string, string> = {
        local: "cardano-preview", // fallback for local
        preview: "cardano-preview",
        preprod: "cardano-preprod",
        mainnet: "cardano-mainnet",
      };

      return new Blockfrost({
        network: networkNameMap[network] as any,
        projectId: apiKey,
      });
    }

    case "maestro": {
      const apiKeyVar = `MAESTRO_${network.toUpperCase()}_API_KEY`;
      const apiKey = getEnvVar(apiKeyVar);

      return new Maestro({
        network: network as any,
        apiKey: apiKey,
      });
    }

    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

export async function createBlaze(
  network: Network,
  providerType?: ProviderType,
): Promise<{ blaze: Blaze<Provider, ColdWallet>; provider: Provider }> {
  const provider = createProvider(network, providerType);
  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const address = Address.fromBech32(deployerAddress);
  const wallet = new ColdWallet(address, networkId, provider);
  const blaze = await Blaze.from(provider, wallet);

  return { blaze, provider };
}

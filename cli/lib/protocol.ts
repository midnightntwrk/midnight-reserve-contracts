import type { ProtocolParameters, TransactionOutput } from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";
import { calculateMinAda } from "@blaze-cardano/tx";

// Re-export ProtocolParameters type for convenience
export type { ProtocolParameters } from "@blaze-cardano/core";

/**
 * Fetches current protocol parameters from the chain.
 */
export async function getProtocolParameters(
  provider: Provider,
): Promise<ProtocolParameters> {
  return provider.getParameters();
}

/**
 * Calculates the minimum ADA required for a transaction output.
 * Wrapper around Blaze's calculateMinAda using coinsPerUtxoByte from protocol params.
 */
export function calculateMinUtxo(
  params: ProtocolParameters,
  output: TransactionOutput,
): bigint {
  return calculateMinAda(output, params.coinsPerUtxoByte);
}

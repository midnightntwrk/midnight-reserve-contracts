import type { Network, ProviderType } from "../lib/types";

export const VALID_NETWORKS: Network[] = [
  "local",
  "preview",
  "preprod",
  "mainnet",
];
export const VALID_PROVIDERS: ProviderType[] = [
  "blockfrost",
  "maestro",
  "emulator",
];
export const VALID_COMPONENTS = [
  "tech-auth",
  "tech-auth-threshold",
  "council",
  "council-threshold",
  "reserve",
  "ics",
  "main-gov",
  "staging-gov",
  "federated-ops",
  "federated-ops-threshold",
];

export function validateNetwork(network: string): Network {
  if (!VALID_NETWORKS.includes(network as Network)) {
    throw new Error(
      `Invalid network '${network}'. Must be one of: ${VALID_NETWORKS.join(", ")}`,
    );
  }
  return network as Network;
}

export function validateProvider(provider: string): ProviderType {
  if (!VALID_PROVIDERS.includes(provider as ProviderType)) {
    throw new Error(
      `Invalid provider '${provider}'. Must be one of: ${VALID_PROVIDERS.join(", ")}`,
    );
  }
  return provider as ProviderType;
}

export function validateTxHash(txHash: string): void {
  if (!txHash || txHash.length !== 64) {
    throw new Error(
      `Invalid transaction hash '${txHash}'. Must be 64 hex characters.`,
    );
  }
  if (!/^[a-fA-F0-9]+$/.test(txHash)) {
    throw new Error(
      `Invalid transaction hash '${txHash}'. Must contain only hex characters.`,
    );
  }
}

export function validateTxIndex(txIndex: number): void {
  if (isNaN(txIndex) || txIndex < 0) {
    throw new Error(
      `Invalid transaction index '${txIndex}'. Must be a non-negative number.`,
    );
  }
}

export function validateComponents(components: string[]): string[] {
  for (const component of components) {
    if (!VALID_COMPONENTS.includes(component)) {
      throw new Error(
        `Invalid component '${component}'. Must be one of: ${VALID_COMPONENTS.join(", ")}`,
      );
    }
  }
  return components;
}

export function parseThreshold(thresholdStr: string): {
  numerator: bigint;
  denominator: bigint;
} {
  const parts = thresholdStr.split("/");
  if (parts.length !== 2) {
    throw new Error(
      `Invalid threshold '${thresholdStr}'. Format must be 'numerator/denominator' (e.g., '2/3')`,
    );
  }
  const numerator = BigInt(parts[0]);
  const denominator = BigInt(parts[1]);

  if (denominator === 0n) {
    throw new Error("Threshold denominator cannot be zero");
  }
  if (numerator > denominator) {
    throw new Error("Threshold numerator cannot be greater than denominator");
  }

  return { numerator, denominator };
}

export function parseAmount(amountStr: string): bigint {
  const amount = BigInt(amountStr);
  if (amount <= 0n) {
    throw new Error(`Amount must be positive, got ${amount}`);
  }
  return amount;
}

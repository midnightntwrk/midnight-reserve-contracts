import type { Network, ProviderType } from "../lib/types";
import { isKnownEnvironment } from "../lib/network-mapping";

/**
 * Core Cardano networks that map 1:1 with the Network type.
 * Additional environments (qanet, devnet-*, etc.) are also accepted
 * and map to these networks via getCardanoNetwork().
 */
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
  "kupmios",
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
  "tcnight-mint-infinite",
  "terms-and-conditions",
  "terms-and-conditions-threshold",
];

export const VALID_TWO_STAGE_VALIDATORS = [
  "tech-auth",
  "council",
  "reserve",
  "ics",
  "federated-ops",
  "terms-and-conditions",
] as const;

export type TwoStageValidator = (typeof VALID_TWO_STAGE_VALIDATORS)[number];

export const VALID_TRANSACTION_NAMES = [
  "technical-authority-deployment",
  "tech-auth-update-threshold-deployment",
  "council-deployment",
  "council-update-threshold-deployment",
  "reserve-deployment",
  "ics-deployment",
  "main-gov-threshold-deployment",
  "staging-gov-threshold-deployment",
  "federated-ops-deployment",
  "federated-ops-update-threshold-deployment",
  "terms-and-conditions-deployment",
  "terms-and-conditions-threshold-deployment",
] as const;

export type TransactionName = (typeof VALID_TRANSACTION_NAMES)[number];

/**
 * Validates the network/environment parameter.
 *
 * Accepts both core network names (local, preview, preprod, mainnet) and
 * extended environment names (qanet, devnet-*, node-dev-*). Unknown
 * environments trigger a warning but are still accepted.
 *
 * The original environment name is preserved so that config loading can
 * use environment-specific sections (e.g., [config.qanet]).
 *
 * @param environment - The network or environment name to validate
 * @returns The validated environment name (preserves original for config lookup)
 */
export function validateNetwork(environment: string): string {
  // First, check if it's a known core network
  if (VALID_NETWORKS.includes(environment as Network)) {
    return environment;
  }

  // Check if it's a known extended environment
  if (isKnownEnvironment(environment)) {
    // Preserve the original environment name for config loading
    return environment;
  }

  // Unknown environment - warn but accept (will default to local/emulator)
  console.warn(
    `Warning: Unknown environment '${environment}'. ` +
      `Known values: ${VALID_NETWORKS.join(", ")}, qanet, govnet, devnet-*, node-dev-*. ` +
      `Defaulting to local/emulator.`,
  );
  return "local";
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

export function validateTransactionName(name: string): TransactionName {
  if (!VALID_TRANSACTION_NAMES.includes(name as TransactionName)) {
    throw new Error(
      `Invalid transaction name '${name}'. Must be one of:\n  ${VALID_TRANSACTION_NAMES.join("\n  ")}`,
    );
  }
  return name as TransactionName;
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

export function validateTwoStageValidator(
  validator: string,
): TwoStageValidator {
  if (!VALID_TWO_STAGE_VALIDATORS.includes(validator as TwoStageValidator)) {
    throw new Error(
      `Invalid two-stage validator '${validator}'. Must be one of: ${VALID_TWO_STAGE_VALIDATORS.join(", ")}`,
    );
  }
  return validator as TwoStageValidator;
}

export function validateScriptHash(hash: string): void {
  if (!hash || hash.length !== 56) {
    throw new Error(
      `Invalid script hash '${hash}'. Must be 56 hex characters.`,
    );
  }
  if (!/^[a-fA-F0-9]+$/.test(hash)) {
    throw new Error(
      `Invalid script hash '${hash}'. Must contain only hex characters.`,
    );
  }
}

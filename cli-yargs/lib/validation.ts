import type { Network } from "./types";

/**
 * Core Cardano networks that map 1:1 with the Network type.
 */
export const VALID_NETWORKS: Network[] = [
  "local",
  "preview",
  "preprod",
  "mainnet",
];

export const VALID_PROVIDERS = [
  "blockfrost",
  "maestro",
  "emulator",
  "kupmios",
] as const;

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
] as const;

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

export function validateHash32(hash: string): void {
  if (!hash || hash.length !== 64) {
    throw new Error(
      `Invalid hash '${hash}'. Must be 64 hex characters (32 bytes).`,
    );
  }
  if (!/^[a-fA-F0-9]+$/.test(hash)) {
    throw new Error(
      `Invalid hash '${hash}'. Must contain only hex characters.`,
    );
  }
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

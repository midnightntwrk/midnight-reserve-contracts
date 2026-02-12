import { NetworkId } from "@blaze-cardano/core";
import {
  getCardanoNetwork as _getCardanoNetwork,
  getNetworkIdFromEnvironment,
  getAikenConfigSection as _getAikenConfigSection,
} from "./network-mapping";

// Re-export for convenience
export { getCardanoNetwork, getAikenConfigSection } from "./network-mapping";

/**
 * Legacy network type for backward compatibility.
 * Use string environment names for new code - they map to Cardano networks via getCardanoNetwork().
 */
export type Network = "local" | "preview" | "preprod" | "mainnet";
export type ProviderType = "blockfrost" | "maestro" | "emulator" | "kupmios";

export interface GlobalOptions {
  /** Environment name (e.g., "preview", "qanet", "govnet", "node-dev-01", "preprod", "mainnet") */
  network: string;
  output: string;
  provider: ProviderType;
  dryRun: boolean;
}

export interface DeployOptions extends GlobalOptions {
  utxoAmount: bigint;
  techAuthThreshold: { numerator: bigint; denominator: bigint };
  councilThreshold: { numerator: bigint; denominator: bigint };
  councilStagingThreshold: { numerator: bigint; denominator: bigint };
  techAuthStagingThreshold: { numerator: bigint; denominator: bigint };
  components: string[];
  name?: string;
}

export interface ChangeAuthOptions extends GlobalOptions {
  txHash: string;
  txIndex: number;
  utxoAmount?: bigint;
  sign: boolean;
  outputFile: string;
  useBuild?: boolean;
}

export interface SimpleTxOptions extends GlobalOptions {
  count: number;
  amount: bigint;
  to?: string;
  outputFile: string;
}

export interface InfoOptions extends GlobalOptions {
  format: "json" | "table";
  component: string;
  fetch: boolean;
  useBuild?: boolean;
}

export interface StageUpgradeOptions extends GlobalOptions {
  validator: string;
  newLogicHash: string;
  txHash: string;
  txIndex: number;
  utxoAmount?: bigint;
  sign: boolean;
  outputFile: string;
  useBuild?: boolean;
}

export interface PromoteUpgradeOptions extends GlobalOptions {
  validator: string;
  txHash: string;
  txIndex: number;
  utxoAmount?: bigint;
  sign: boolean;
  outputFile: string;
  useBuild?: boolean;
}

export interface RegisterGovAuthOptions extends GlobalOptions {
  outputFile: string;
  useBuild?: boolean;
}

export interface GenerateKeyOptions {
  /** Environment name */
  network: string;
}

export interface SignAndSubmitOptions {
  /** Environment name */
  network: string;
  provider: ProviderType;
  jsonFile: string;
  signingKeyEnvVar: string;
  /** Whether to sign with the deployer key (default: true) */
  signDeployer: boolean;
}

export interface CombineSignaturesOptions {
  /** Environment name */
  network: string;
  provider: ProviderType;
  txFile: string;
  witnessFiles: string[];
  /** Whether to also sign with the deployer key (default: true) */
  signDeployer: boolean;
  /** Environment variable name for the deployer signing key */
  signingKeyEnvVar: string;
}

export interface ChangeTermsOptions extends GlobalOptions {
  txHash: string;
  txIndex: number;
  hash: string;
  url: string;
  utxoAmount?: bigint;
  sign: boolean;
  outputFile: string;
  useBuild?: boolean;
}

export interface MintTcnightOptions extends GlobalOptions {
  userAddress: string;
  destinationAddress?: string;
  amount: bigint;
  burn: boolean;
  outputFile: string;
  useBuild?: boolean;
}

export interface Signer {
  paymentHash: string;
  sr25519Key: string;
}

export interface NetworkConfig {
  technical_authority_one_shot_hash: string;
  technical_authority_one_shot_index: number;
  council_one_shot_hash: string;
  council_one_shot_index: number;
  reserve_one_shot_hash: string;
  reserve_one_shot_index: number;
  ics_one_shot_hash: string;
  ics_one_shot_index: number;
  federated_operators_one_shot_hash: string;
  federated_operators_one_shot_index: number;
  main_gov_one_shot_hash: string;
  main_gov_one_shot_index: number;
  staging_gov_one_shot_hash: string;
  staging_gov_one_shot_index: number;
  main_council_update_one_shot_hash: string;
  main_council_update_one_shot_index: number;
  main_tech_auth_update_one_shot_hash: string;
  main_tech_auth_update_one_shot_index: number;
  main_federated_ops_update_one_shot_hash: string;
  main_federated_ops_update_one_shot_index: number;
  terms_and_conditions_one_shot_hash: string;
  terms_and_conditions_one_shot_index: number;
  terms_and_conditions_threshold_one_shot_hash: string;
  terms_and_conditions_threshold_one_shot_index: number;
  collateral_utxo_hash: string;
  collateral_utxo_index: number;
  cnight_policy: string;
  cnight_name: string;
  // Staging forever one-shot refs
  reserve_staging_one_shot_hash: string;
  reserve_staging_one_shot_index: number;
  council_staging_one_shot_hash: string;
  council_staging_one_shot_index: number;
  ics_staging_one_shot_hash: string;
  ics_staging_one_shot_index: number;
  technical_authority_staging_one_shot_hash: string;
  technical_authority_staging_one_shot_index: number;
  federated_operators_staging_one_shot_hash: string;
  federated_operators_staging_one_shot_index: number;
  terms_and_conditions_staging_one_shot_hash: string;
  terms_and_conditions_staging_one_shot_index: number;
  // V2 logic one-shot refs (for StagingState NFT minting)
  reserve_logic_v2_one_shot_hash: string;
  reserve_logic_v2_one_shot_index: number;
  ics_logic_v2_one_shot_hash: string;
  ics_logic_v2_one_shot_index: number;
  council_logic_v2_one_shot_hash: string;
  council_logic_v2_one_shot_index: number;
  technical_authority_logic_v2_one_shot_hash: string;
  technical_authority_logic_v2_one_shot_index: number;
  federated_operators_logic_v2_one_shot_hash: string;
  federated_operators_logic_v2_one_shot_index: number;
  terms_and_conditions_logic_v2_one_shot_hash: string;
  terms_and_conditions_logic_v2_one_shot_index: number;
}

export interface TransactionOutput {
  type: string;
  description: string;
  cborHex: string;
  txHash: string;
  signed: boolean;
}

export interface DeploymentTransactionsJson {
  transactions: TransactionOutput[];
}

export interface DeploymentOutput {
  network: string;
  timestamp: string;
  config: {
    utxoAmount: string;
  };
  transactions: TransactionOutput[];
}

/**
 * Gets the Blaze NetworkId for the given network/environment.
 * Delegates to getNetworkIdFromEnvironment for consistent mapping.
 */
export function getNetworkId(network: Network | string): NetworkId {
  return getNetworkIdFromEnvironment(network);
}

/**
 * Gets the default provider for the given network/environment.
 * Returns "emulator" for local environments, "blockfrost" for real networks.
 */
export function getDefaultProvider(network: Network | string): ProviderType {
  const cardanoNetwork = _getCardanoNetwork(network);
  return cardanoNetwork === null ? "emulator" : "blockfrost";
}

/**
 * Gets the aiken.toml config section for the given network/environment.
 * Delegates to getAikenConfigSection for consistent mapping.
 */
export function getConfigSection(network: Network | string): string {
  return _getAikenConfigSection(network);
}

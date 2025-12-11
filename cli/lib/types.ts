import { NetworkId } from "@blaze-cardano/core";

export type Network = "local" | "preview" | "preprod" | "mainnet";
export type ProviderType = "blockfrost" | "maestro" | "emulator";

export interface GlobalOptions {
  network: Network;
  output: string;
  provider: ProviderType;
  dryRun: boolean;
}

export interface DeployOptions extends GlobalOptions {
  utxoAmount: bigint;
  outputAmount: bigint;
  thresholdOutputAmount: bigint;
  techAuthThreshold: { numerator: bigint; denominator: bigint };
  councilThreshold: { numerator: bigint; denominator: bigint };
  councilStagingThreshold: { numerator: bigint; denominator: bigint };
  techAuthStagingThreshold: { numerator: bigint; denominator: bigint };
  components: string[];
}

export interface ChangeAuthOptions extends GlobalOptions {
  txHash: string;
  txIndex: number;
  utxoAmount?: bigint;
  sign: boolean;
  outputFile: string;
}

export interface SimpleTxOptions extends GlobalOptions {
  count: number;
  amount: bigint;
  to?: string;
}

export interface InfoOptions extends GlobalOptions {
  format: "json" | "table";
  component: string;
  fetch: boolean;
}

export interface StageUpgradeOptions extends GlobalOptions {
  validator: string;
  newLogicHash: string;
  txHash: string;
  txIndex: number;
  utxoAmount?: bigint;
  sign: boolean;
  outputFile: string;
}

export interface PromoteUpgradeOptions extends GlobalOptions {
  validator: string;
  txHash: string;
  txIndex: number;
  utxoAmount?: bigint;
  sign: boolean;
  outputFile: string;
}

export interface RegisterGovAuthOptions extends GlobalOptions {
  outputFile: string;
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
  cnight_policy: string;
}

export interface TransactionOutput {
  name: string;
  cbor: string;
  hash: string;
}

export interface DeploymentOutput {
  network: string;
  timestamp: string;
  config: {
    utxoAmount: string;
    outputAmount: string;
    thresholdOutputAmount: string;
  };
  transactions: TransactionOutput[];
}

export function getNetworkId(network: Network): NetworkId {
  return network === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet;
}

export function getDefaultProvider(network: Network): ProviderType {
  return network === "local" ? "emulator" : "blockfrost";
}

export function getConfigSection(network: Network): string {
  return network === "local" ? "default" : network;
}

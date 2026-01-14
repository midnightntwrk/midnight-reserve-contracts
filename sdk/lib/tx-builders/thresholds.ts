/**
 * Transaction builders for threshold contract deployment
 *
 * Thresholds store MultisigThreshold ratios for different operations
 */

import type {
  Blaze,
  TransactionBuilder,
  TransactionUnspentOutput,
} from "@blaze-cardano/sdk";
import {
  addressFromValidator,
  AssetName,
  PolicyId,
  TransactionOutput,
  PlutusData,
  AssetId,
  PaymentAddress,
  type Script,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type * as Contracts from "../../../contract_blueprint";

export interface DeployThresholdParams {
  blaze: Blaze;
  thresholdScript: Script;
  oneShotUtxo: TransactionUnspentOutput;
  /** MultisigThreshold: [tech_auth_num, tech_auth_denom, council_num, council_denom] */
  threshold: [bigint, bigint, bigint, bigint];
  networkId: number;
}

/**
 * Build a transaction to deploy a threshold contract
 *
 * Threshold contracts mint an NFT and store a MultisigThreshold datum.
 * The threshold defines required signature ratios for Council and TechAuth.
 *
 * MultisigThreshold format: [tech_auth_num, tech_auth_denom, council_num, council_denom]
 * Example: [1, 2, 1, 1] means "½ of TechAuth required, all Council required"
 * Example: [1, 1, 0, 1] means "all TechAuth required, 0 Council required"
 */
export async function buildThresholdDeploymentTx(
  params: DeployThresholdParams
): Promise<TransactionBuilder> {
  const {
    blaze,
    thresholdScript,
    oneShotUtxo,
    threshold,
    networkId,
  } = params;

  const Contracts = await import("../../../contract_blueprint");

  // Validate threshold ratios
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = threshold;

  if (techAuthNum < 0n || councilNum < 0n) {
    throw new Error("Threshold numerators must be non-negative");
  }

  if (techAuthNum > techAuthDenom) {
    throw new Error("TechAuth numerator cannot exceed denominator");
  }

  if (councilNum > councilDenom) {
    throw new Error("Council numerator cannot exceed denominator");
  }

  if (techAuthDenom <= 0n || councilDenom <= 0n) {
    throw new Error("Threshold denominators must be positive");
  }

  // Get threshold validator address
  const thresholdAddress = addressFromValidator(networkId, thresholdScript);

  // Create MultisigThreshold datum
  const thresholdDatum: typeof Contracts.MultisigThreshold = threshold;

  // Build transaction
  return blaze
    .newTransaction()
    .addInput(oneShotUtxo)
    .addMint(
      PolicyId(thresholdScript.hash()),
      new Map([[AssetName(""), 1n]]),
      PlutusData.newInteger(0n) // Threshold minting policy uses 0 as redeemer
    )
    .provideScript(thresholdScript)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(thresholdAddress.toBech32()),
        value: {
          coins: 2_000_000n, // 2 ADA minimum
          assets: new Map([[AssetId(thresholdScript.hash()), 1n]]),
        },
        datum: serialize(Contracts.MultisigThreshold, thresholdDatum).toCore(),
      })
    );
}

/**
 * Deploy all threshold contracts at once
 *
 * This is a convenience function to deploy all 5 threshold contracts
 * used by the governance system.
 */
export interface DeployAllThresholdsParams {
  blaze: Blaze;
  thresholds: {
    mainGov: { script: Script; oneShotUtxo: TransactionUnspentOutput };
    stagingGov: { script: Script; oneShotUtxo: TransactionUnspentOutput };
    mainCouncilUpdate: { script: Script; oneShotUtxo: TransactionUnspentOutput };
    mainTechAuthUpdate: { script: Script; oneShotUtxo: TransactionUnspentOutput };
    mainFederatedOpsUpdate: { script: Script; oneShotUtxo: TransactionUnspentOutput };
  };
  /** Initial threshold ratios (same for all) */
  initialThreshold: [bigint, bigint, bigint, bigint];
  networkId: number;
}

/**
 * Build a single transaction that deploys all threshold contracts
 *
 * This is more efficient than deploying them individually.
 */
export async function buildDeployAllThresholdsTx(
  params: DeployAllThresholdsParams
): Promise<TransactionBuilder> {
  const { blaze, thresholds, initialThreshold, networkId } = params;
  const Contracts = await import("../../../contract_blueprint");

  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = initialThreshold;

  // Validate threshold ratios
  if (techAuthNum < 0n || councilNum < 0n) {
    throw new Error("Threshold numerators must be non-negative");
  }
  if (techAuthNum > techAuthDenom || councilNum > councilDenom) {
    throw new Error("Numerators cannot exceed denominators");
  }
  if (techAuthDenom <= 0n || councilDenom <= 0n) {
    throw new Error("Denominators must be positive");
  }

  const thresholdDatum: typeof Contracts.MultisigThreshold = initialThreshold;

  let txBuilder = blaze.newTransaction();

  // Add all one-shot inputs and outputs
  for (const [name, { script, oneShotUtxo }] of Object.entries(thresholds)) {
    const address = addressFromValidator(networkId, script);

    txBuilder = txBuilder
      .addInput(oneShotUtxo)
      .addMint(
        PolicyId(script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n)
      )
      .provideScript(script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(address.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(script.hash()), 1n]]),
          },
          datum: serialize(Contracts.MultisigThreshold, thresholdDatum).toCore(),
        })
      );
  }

  return txBuilder;
}

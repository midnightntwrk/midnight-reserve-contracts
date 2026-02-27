/**
 * Transaction builders for Midnight Reserve contracts
 *
 * This module provides reusable transaction building functions extracted from CLI commands.
 */

import {
  Address,
  AssetId,
  AssetName,
  PlutusData,
  PolicyId,
  Script,
  TransactionOutput,
  PaymentAddress,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import type { Blaze } from "@blaze-cardano/sdk";
import * as Contracts from "../contract_blueprint";

export {
  createNativeMultisigScript,
  createRewardAccount,
  findUtxoWithMainAsset,
} from "../cli/utils/transaction";

export {
  parseSigners,
  extractSignersFromCbor,
  createMultisigStateCbor,
  createRedeemerMapCbor,
} from "./signers";

/**
 * Options for updating multisig configuration on Council/TechAuth/Reserve
 */
export interface UpdateMultisigOptions {
  /** New signers for the multisig */
  newSigners: Array<{ paymentHash: string; sr25519Key: string }>;
  /** Current round number from the forever contract */
  currentRound: bigint;
  /** Network ID (0 for testnet, 1 for mainnet) */
  networkId: number;
}

/**
 * Parse the current multisig state from a forever contract UTxO
 */
export function parseForeverMultisigState(
  utxo: TransactionUnspentOutput
): {
  state: Contracts.VersionedMultisig;
  signers: Array<{ paymentHash: string; sr25519Key: string }>;
} {
  const datum = utxo.output().datum();
  if (!datum?.asInlineData()) {
    throw new Error("Missing inline datum on forever UTxO");
  }

  const state = parse(Contracts.VersionedMultisig, datum.asInlineData()!);
  const signers = extractSignersFromCbor(datum.asInlineData()!);

  return { state, signers };
}

/**
 * Parse the UpgradeState from a two-stage contract UTxO
 */
export function parseTwoStageUpgradeState(
  utxo: TransactionUnspentOutput
): Contracts.UpgradeState {
  const datum = utxo.output().datum();
  if (!datum?.asInlineData()) {
    throw new Error("Missing inline datum on two-stage UTxO");
  }

  return parse(Contracts.UpgradeState, datum.asInlineData()!);
}

/**
 * Find a script by its hash in the known contract instances
 */
export function findScriptByHash(hash: string): Script | null {
  // This will be implemented to search through all known contracts
  // For now, return null and let the caller handle it
  return null;
}

/**
 * Build transaction to update Council multisig configuration
 *
 * This follows the pattern from cli/commands/change-council.ts
 */
export interface UpdateCouncilMultisigParams {
  blaze: Blaze;
  councilForeverUtxo: TransactionUnspentOutput;
  councilThresholdUtxo: TransactionUnspentOutput;
  techAuthForeverUtxo: TransactionUnspentOutput;
  councilTwoStageUtxo: TransactionUnspentOutput;
  newSigners: Array<{ paymentHash: string; sr25519Key: string }>;
  councilForeverScript: Script;
  councilLogicScript: Script;
  mitigationLogicScript: Script | null;
  networkId: number;
}

/**
 * Build transaction to update Reserve multisig configuration
 *
 * This adapts the Council pattern for Reserve contracts
 */
export interface UpdateReserveMultisigParams {
  blaze: Blaze;
  reserveForeverUtxo: TransactionUnspentOutput;
  reserveTwoStageUtxo: TransactionUnspentOutput;
  newSigners: Array<{ paymentHash: string; sr25519Key: string }>;
  reserveForeverScript: Script;
  govAuthScript: Script;
  networkId: number;
}

/**
 * Build transaction to update Reserve multisig configuration
 *
 * This updates the multisig datum stored in the Reserve forever contract.
 * Note: Reserve logic uses logic_merge (not multisig validation), so this
 * update doesn't require multisig authorization - it just needs to satisfy
 * the forever contract requirements (reference two-stage, add logic withdrawal).
 */
export async function buildReserveUpdateMultisigTx(params: {
  ctx: any; // JourneyContext
  newThreshold: bigint;
  newSigners: Record<string, string>;
  reserveForeverUtxo: TransactionUnspentOutput;
  reserveTwoStageMainUtxo: TransactionUnspentOutput;
}) {
  const { ctx, newThreshold, newSigners, reserveForeverUtxo, reserveTwoStageMainUtxo } = params;

  const {
    addressFromValidator,
    AssetId,
    NetworkId,
    PlutusData,
    TransactionOutput,
    PaymentAddress,
    RewardAccount,
    Credential,
    CredentialType,
    Hash28ByteBase16,
  } = await import("@blaze-cardano/core");
  const { serialize, parse } = await import("@blaze-cardano/data");
  const Contracts = await import("../contract_blueprint");
  const { ContractsManager } = await import("../test-plan/lib/contracts");

  const contracts = new ContractsManager();
  const reserve = await contracts.getReserve();
  const blaze = await ctx.provider.getBlaze("deployer");

  // Parse current Reserve forever state to get the round
  const currentDatum = reserveForeverUtxo.output().datum();
  if (!currentDatum?.asInlineData()) {
    throw new Error("Missing inline datum on Reserve forever UTxO");
  }
  const currentState = parse(Contracts.VersionedMultisig, currentDatum.asInlineData()!);
  const currentRound = currentState[1];

  // Parse Reserve two-stage to get logic script hash
  const twoStageDatum = reserveTwoStageMainUtxo.output().datum();
  if (!twoStageDatum?.asInlineData()) {
    throw new Error("Missing inline datum on Reserve two-stage UTxO");
  }
  const upgradeState = parse(Contracts.UpgradeState, twoStageDatum.asInlineData()!);
  const [logicHash] = upgradeState;

  // Create updated multisig state
  const signerCount = BigInt(Object.keys(newSigners).length);
  const newReserveForeverState: Contracts.VersionedMultisig = [
    [signerCount, newSigners],
    currentRound,
  ];

  // Get Reserve forever address
  const reserveForeverAddress = addressFromValidator(
    NetworkId.Testnet,
    reserve.forever.Script,
  );

  // Create reward account for logic withdrawal
  const logicRewardAccount = RewardAccount.fromCredential(
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(logicHash),
    }).toCore(),
    NetworkId.Testnet,
  );

  // Build transaction
  return blaze
    .newTransaction()
    .addInput(reserveForeverUtxo, PlutusData.newInteger(0n))
    .addReferenceInput(reserveTwoStageMainUtxo)
    .provideScript(reserve.forever.Script)
    .provideScript(reserve.logic.Script)
    .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(reserveForeverAddress.toBech32()),
        value: {
          coins: reserveForeverUtxo.output().amount().coin(),
          assets: new Map([[AssetId(reserve.forever.Script.hash()), 1n]]),
        },
        datum: serialize(Contracts.VersionedMultisig, newReserveForeverState).toCore(),
      }),
    );
}

// TODO: Implement Council/TechAuth transaction builders
// export async function buildUpdateCouncilMultisigTx(params: UpdateCouncilMultisigParams) { ... }

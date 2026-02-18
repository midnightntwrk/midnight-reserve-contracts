/**
 * Transaction builders for Reserve deployment
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
  toHex,
  Script,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type * as Contracts from "../../../contract_blueprint";

export interface BuildReserveDeploymentTxParams {
  blaze: Blaze;
  // Scripts
  reserveForeverScript: Script;
  reserveTwoStageScript: Script;
  reserveLogicScript: Script;
  govAuthScript: Script;
  // UTxO
  reserveOneShotUtxo: TransactionUnspentOutput;
  // Initial state
  signers: Record<string, string>; // Raw payment hashes (no 8200581c prefix) => SR25519 keys
  networkId: number;
}

/**
 * Build a transaction to deploy the Reserve contracts
 *
 * This deploys:
 * 1. Reserve Forever Contract - stores VersionedMultisig (but doesn't enforce it!)
 * 2. Reserve Two-Stage Contract - stores UpgradeState with logic/auth hashes
 *
 * CRITICAL DIFFERENCES from Council/TechAuth:
 * - Reserve uses RAW payment hashes (no "8200581c" prefix)
 * - reserve_init_validation() just returns True (doesn't validate signer format)
 * - Reserve forever NFT CANNOT be spent (logic_merge forbids it)
 * - Authorization is delegated to gov_auth
 */
export async function buildReserveDeploymentTx(
  params: BuildReserveDeploymentTxParams
): Promise<TransactionBuilder> {
  const {
    blaze,
    reserveForeverScript,
    reserveTwoStageScript,
    reserveLogicScript,
    govAuthScript,
    reserveOneShotUtxo,
    signers,
    networkId,
  } = params;

  const Contracts = await import("../../../contract_blueprint");

  // Get script addresses
  const reserveForeverAddress = addressFromValidator(networkId, reserveForeverScript);
  const reserveTwoStageAddress = addressFromValidator(networkId, reserveTwoStageScript);

  // Create VersionedMultisig datum for Reserve forever
  // Format: [[totalSigners, signerMap], round]
  // NOTE: Reserve uses raw payment hashes (no prefix), unlike Council
  const signerCount = BigInt(Object.keys(signers).length);
  const reserveForeverState: typeof Contracts.VersionedMultisig = [
    [signerCount, signers],
    0n, // Initial round
  ];

  // Create UpgradeState datum for Reserve two-stage
  // Format: [logic_hash, mitigation_logic, auth_hash, mitigation_auth, reserved1, reserved2]
  const reserveUpgradeState: typeof Contracts.UpgradeState = [
    reserveLogicScript.hash(),
    "", // No mitigation logic initially
    govAuthScript.hash(),
    "", // No mitigation auth initially
    0n, // reserved1
    0n, // reserved2
  ];

  // Reserve redeemer uses raw payment hashes (matching datum format)
  const redeemerForever: typeof Contracts.PermissionedRedeemer = signers;

  // Build transaction
  // CRITICAL: Two-stage minting expects main and staging outputs to be FIRST
  // Order: 1. Main, 2. Staging, 3. Forever
  return blaze
    .newTransaction()
    .addInput(reserveOneShotUtxo)
    .addMint(
      PolicyId(reserveTwoStageScript.hash()),
      new Map([
        [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
        [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
      ]),
      PlutusData.newInteger(0n)
    )
    .addMint(
      PolicyId(reserveForeverScript.hash()),
      new Map([[AssetName(""), 1n]]),
      serialize(Contracts.PermissionedRedeemer, redeemerForever)
    )
    .provideScript(reserveTwoStageScript)
    .provideScript(reserveForeverScript)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(reserveTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [AssetId(reserveTwoStageScript.hash() + toHex(new TextEncoder().encode("main"))), 1n],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, reserveUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(reserveTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [AssetId(reserveTwoStageScript.hash() + toHex(new TextEncoder().encode("staging"))), 1n],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, reserveUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(reserveForeverAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(reserveForeverScript.hash()), 1n]]),
        },
        datum: serialize(Contracts.VersionedMultisig, reserveForeverState).toCore(),
      })
    );
}

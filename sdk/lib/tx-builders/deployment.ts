/**
 * Transaction builders for contract deployment
 *
 * Handles deployment of all contract types: Council, TechAuth, Reserve, ICS, Thresholds, etc.
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
  NetworkId,
  PlutusData,
  AssetId,
  PaymentAddress,
  toHex,
  type Script,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type * as Contracts from "../../../contract_blueprint";

export interface DeployCouncilParams {
  blaze: Blaze;
  councilForeverScript: Script;
  councilTwoStageScript: Script;
  councilLogicScript: Script;
  govAuthScript: Script;
  councilOneShotUtxo: TransactionUnspentOutput;
  threshold: bigint;
  /** Signers with 8200581c prefix for Council */
  signers: Record<string, string>;
  networkId: number;
}

/**
 * Build a transaction to deploy the Council contract
 *
 * Council uses:
 * - Datum: 8200581c + paymentHash (32-byte format with prefix)
 * - Redeemer: raw 28-byte paymentHash (validator adds prefix via create_signer)
 */
export async function buildCouncilDeploymentTx(
  params: DeployCouncilParams
): Promise<TransactionBuilder> {
  const {
    blaze,
    councilForeverScript,
    councilTwoStageScript,
    councilLogicScript,
    govAuthScript,
    councilOneShotUtxo,
    threshold,
    signers,
    networkId,
  } = params;

  const Contracts = await import("../../../contract_blueprint");

  // Get script addresses
  const councilForeverAddress = addressFromValidator(
    networkId,
    councilForeverScript
  );
  const councilTwoStageAddress = addressFromValidator(
    networkId,
    councilTwoStageScript
  );

  // Create upgrade state datum for Council two-stage
  const councilUpgradeState: typeof Contracts.UpgradeState = [
    councilLogicScript.hash(),
    "",
    govAuthScript.hash(),
    "",
    0n,
    0n,
  ];

  // Create multisig state for Council forever
  // VersionedMultisig is a tuple: [[total_signers, signers], round]
  const signerCount = BigInt(Object.keys(signers).length);

  // The datum stores prefixed keys (32 bytes each)
  const councilForeverState: typeof Contracts.VersionedMultisig = [
    [signerCount, signers],
    0n,
  ];

  // The redeemer contains raw 28-byte payment hashes (without prefix)
  // The validator will call create_signer to add the prefix
  const redeemerSigners: Record<string, string> = {};
  for (const [key, value] of Object.entries(signers)) {
    // Remove the "8200581c" prefix to get the raw 28-byte hash
    const rawHash = key.replace(/^8200581c/i, "");
    redeemerSigners[rawHash] = value;
  }
  const redeemerForever: typeof Contracts.PermissionedRedeemer = redeemerSigners;

  // Build the transaction
  return blaze
    .newTransaction()
    .addInput(councilOneShotUtxo)
    .addMint(
      PolicyId(councilForeverScript.hash()),
      new Map([[AssetName(""), 1n]]),
      serialize(Contracts.PermissionedRedeemer, redeemerForever)
    )
    .addMint(
      PolicyId(councilTwoStageScript.hash()),
      new Map([
        [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
        [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
      ]),
      PlutusData.newInteger(0n)
    )
    .provideScript(councilTwoStageScript)
    .provideScript(councilForeverScript)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(councilTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                councilTwoStageScript.hash() +
                  toHex(new TextEncoder().encode("main"))
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, councilUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(councilTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                councilTwoStageScript.hash() +
                  toHex(new TextEncoder().encode("staging"))
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, councilUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(councilForeverAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(councilForeverScript.hash()), 1n]]),
        },
        datum: serialize(Contracts.VersionedMultisig, councilForeverState).toCore(),
      })
    );
}

export interface DeployTechAuthParams {
  blaze: Blaze;
  techAuthForeverScript: Script;
  techAuthTwoStageScript: Script;
  techAuthLogicScript: Script;
  govAuthScript: Script;
  techAuthOneShotUtxo: TransactionUnspentOutput;
  threshold: bigint;
  /** Signers with 8200581c prefix for TechAuth (same as Council) */
  signers: Record<string, string>;
  networkId: number;
}

/**
 * Build a transaction to deploy the TechAuth contract
 *
 * TechAuth follows the same pattern as Council
 */
export async function buildTechAuthDeploymentTx(
  params: DeployTechAuthParams
): Promise<TransactionBuilder> {
  const {
    blaze,
    techAuthForeverScript,
    techAuthTwoStageScript,
    techAuthLogicScript,
    govAuthScript,
    techAuthOneShotUtxo,
    threshold,
    signers,
    networkId,
  } = params;

  const Contracts = await import("../../../contract_blueprint");

  // Get script addresses
  const techAuthForeverAddress = addressFromValidator(
    networkId,
    techAuthForeverScript
  );
  const techAuthTwoStageAddress = addressFromValidator(
    networkId,
    techAuthTwoStageScript
  );

  // Create upgrade state datum for TechAuth two-stage
  const techAuthUpgradeState: typeof Contracts.UpgradeState = [
    techAuthLogicScript.hash(),
    "",
    govAuthScript.hash(),
    "",
    0n,
    0n,
  ];

  // Create multisig state for TechAuth forever
  const signerCount = BigInt(Object.keys(signers).length);
  const techAuthForeverState: typeof Contracts.VersionedMultisig = [
    [signerCount, signers],
    0n,
  ];

  // Redeemer with raw 28-byte hashes (same as Council)
  const redeemerSigners: Record<string, string> = {};
  for (const [key, value] of Object.entries(signers)) {
    const rawHash = key.replace(/^8200581c/i, "");
    redeemerSigners[rawHash] = value;
  }
  const redeemerForever: typeof Contracts.PermissionedRedeemer = redeemerSigners;

  // Build the transaction (same pattern as Council)
  return blaze
    .newTransaction()
    .addInput(techAuthOneShotUtxo)
    .addMint(
      PolicyId(techAuthForeverScript.hash()),
      new Map([[AssetName(""), 1n]]),
      serialize(Contracts.PermissionedRedeemer, redeemerForever)
    )
    .addMint(
      PolicyId(techAuthTwoStageScript.hash()),
      new Map([
        [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
        [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
      ]),
      PlutusData.newInteger(0n)
    )
    .provideScript(techAuthTwoStageScript)
    .provideScript(techAuthForeverScript)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                techAuthTwoStageScript.hash() +
                  toHex(new TextEncoder().encode("main"))
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, techAuthUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                techAuthTwoStageScript.hash() +
                  toHex(new TextEncoder().encode("staging"))
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, techAuthUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(techAuthForeverAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(techAuthForeverScript.hash()), 1n]]),
        },
        datum: serialize(Contracts.VersionedMultisig, techAuthForeverState).toCore(),
      })
    );
}

export interface DeployReserveParams {
  blaze: Blaze;
  reserveForeverScript: Script;
  reserveTwoStageScript: Script;
  reserveLogicScript: Script;
  govAuthScript: Script;
  reserveOneShotUtxo: TransactionUnspentOutput;
  threshold: bigint;
  /** Signers WITHOUT prefix for Reserve (raw 28-byte payment hashes) */
  signers: Record<string, string>;
  networkId: number;
}

/**
 * Build a transaction to deploy the Reserve contract
 *
 * Reserve uses raw payment hashes (NO prefix), unlike Council/TechAuth
 */
export async function buildReserveDeploymentTx(
  params: DeployReserveParams
): Promise<TransactionBuilder> {
  const {
    blaze,
    reserveForeverScript,
    reserveTwoStageScript,
    reserveLogicScript,
    govAuthScript,
    reserveOneShotUtxo,
    threshold,
    signers,
    networkId,
  } = params;

  const Contracts = await import("../../../contract_blueprint");

  // Get script addresses
  const reserveForeverAddress = addressFromValidator(
    networkId,
    reserveForeverScript
  );
  const reserveTwoStageAddress = addressFromValidator(
    networkId,
    reserveTwoStageScript
  );

  // Create upgrade state datum for Reserve two-stage
  const reserveUpgradeState: typeof Contracts.UpgradeState = [
    reserveLogicScript.hash(),
    "",
    govAuthScript.hash(),
    "",
    0n,
    0n,
  ];

  // Create multisig state for Reserve forever
  // NOTE: Reserve uses raw payment hashes (no 8200581c prefix), unlike Council
  const signerCount = BigInt(Object.keys(signers).length);
  const reserveForeverState: typeof Contracts.VersionedMultisig = [
    [signerCount, signers],
    0n,
  ];

  // Reserve redeemer uses the same format as datum (raw 28-byte payment hashes)
  const redeemerForever: typeof Contracts.PermissionedRedeemer = signers;

  // Build the transaction
  return blaze
    .newTransaction()
    .addInput(reserveOneShotUtxo)
    .addMint(
      PolicyId(reserveForeverScript.hash()),
      new Map([[AssetName(""), 1n]]),
      serialize(Contracts.PermissionedRedeemer, redeemerForever)
    )
    .addMint(
      PolicyId(reserveTwoStageScript.hash()),
      new Map([
        [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
        [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
      ]),
      PlutusData.newInteger(0n)
    )
    .provideScript(reserveTwoStageScript)
    .provideScript(reserveForeverScript)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(reserveTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                reserveTwoStageScript.hash() +
                  toHex(new TextEncoder().encode("main"))
              ),
              1n,
            ],
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
            [
              AssetId(
                reserveTwoStageScript.hash() +
                  toHex(new TextEncoder().encode("staging"))
              ),
              1n,
            ],
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

// TODO: Add deployment builders for:
// - Threshold contracts
// - ICS contract
// - Other governance contracts

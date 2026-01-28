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

// ============================================================================
// Threshold Update Operations
// ============================================================================

export interface UpdateThresholdParams {
  blaze: Blaze;
  // Scripts
  thresholdScript: Script;
  councilLogicScript: Script;
  techAuthLogicScript: Script;
  govAuthScript: Script;
  // UTxOs
  thresholdUtxo: TransactionUnspentOutput;
  mainGovThresholdUtxo: TransactionUnspentOutput; // Required for authorization thresholds
  councilForeverUtxo: TransactionUnspentOutput;
  techAuthForeverUtxo: TransactionUnspentOutput;
  councilTwoStageMainUtxo: TransactionUnspentOutput;
  techAuthTwoStageMainUtxo: TransactionUnspentOutput;
  // New threshold
  newThreshold: [bigint, bigint, bigint, bigint];
  // Current authorization thresholds (for native script building)
  currentCouncilThreshold: { numerator: bigint; denominator: bigint };
  currentTechAuthThreshold: { numerator: bigint; denominator: bigint };
  networkId: number;
}

/**
 * Build a transaction to update a threshold contract's datum
 *
 * This performs a threshold update which:
 * 1. Spends the threshold UTxO
 * 2. Creates a new threshold UTxO with updated MultisigThreshold datum
 * 3. Requires authorization via native scripts and withdrawals (council + tech-auth)
 */
export async function buildUpdateThresholdTx(
  params: UpdateThresholdParams
): Promise<TransactionBuilder> {
  const {
    blaze,
    thresholdScript,
    councilLogicScript,
    techAuthLogicScript,
    govAuthScript,
    thresholdUtxo,
    mainGovThresholdUtxo,
    councilForeverUtxo,
    techAuthForeverUtxo,
    councilTwoStageMainUtxo,
    techAuthTwoStageMainUtxo,
    newThreshold,
    currentCouncilThreshold,
    currentTechAuthThreshold,
    networkId,
  } = params;

  const Contracts = await import("../../../contract_blueprint");
  const {
    RewardAccount,
    NetworkId,
    CredentialType,
    NativeScripts,
    addressFromCredential,
    Credential,
    Hash28ByteBase16,
    Script,
  } = await import("@blaze-cardano/core");

  // Validate new threshold
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = newThreshold;

  if (techAuthNum < 0n || councilNum < 0n) {
    throw new Error("Threshold numerators must be non-negative");
  }
  if (techAuthNum > techAuthDenom || councilNum > councilDenom) {
    throw new Error("Numerators cannot exceed denominators");
  }
  if (techAuthDenom <= 0n || councilDenom <= 0n) {
    throw new Error("Denominators must be positive");
  }

  // Get threshold validator address
  const thresholdAddress = addressFromValidator(networkId, thresholdScript);

  // Read current multisig states for native script building
  // IMPORTANT: Use extractSignersFromCbor to preserve duplicate keys (weighted voting)
  const { extractSignersFromCbor } = await import("../../../cli/lib/signers");
  const { readVersionedMultisigState } = await import("../helpers/state-readers");

  // Get raw datum to extract signers with duplicates preserved
  const councilDatum = councilForeverUtxo.output().datum()?.asInlineData();
  const techAuthDatum = techAuthForeverUtxo.output().datum()?.asInlineData();
  if (!councilDatum || !techAuthDatum) {
    throw new Error("Missing inline datum on council or tech-auth UTxO");
  }

  const councilSigners = extractSignersFromCbor(councilDatum);
  const techAuthSigners = extractSignersFromCbor(techAuthDatum);

  // Helper function to build native script from signers array (preserves duplicates)
  const buildNativeScript = (
    signers: Array<{ paymentHash: string; sr25519Key: string }>,
    numerator: bigint,
    denominator: bigint
  ) => {
    const totalSigners = BigInt(signers.length);

    // Calculate min_signers (ceil division)
    const minSigners = (totalSigners * numerator + (denominator - 1n)) / denominator;

    // Build signer scripts - one for each entry (including duplicates)
    const signerScripts = signers.map((signer) => {
      // Convert to bech32 address
      const bech32 = addressFromCredential(
        networkId,
        Credential.fromCore({
          type: CredentialType.KeyHash,
          hash: Hash28ByteBase16(signer.paymentHash),
        })
      ).toBech32();

      return NativeScripts.justAddress(bech32, networkId);
    });

    // Build N-of-M native script
    const nativeScript = NativeScripts.atLeastNOfK(
      Number(minSigners),
      ...signerScripts
    );

    // Wrap and get policy ID
    const script = Script.newNativeScript(nativeScript);
    const policyId = script.hash();

    return { script, policyId };
  };

  const { script: councilNativeScript, policyId: councilPolicyId } =
    buildNativeScript(
      councilSigners,
      currentCouncilThreshold.numerator,
      currentCouncilThreshold.denominator
    );

  const { script: techAuthNativeScript, policyId: techAuthPolicyId } =
    buildNativeScript(
      techAuthSigners,
      currentTechAuthThreshold.numerator,
      currentTechAuthThreshold.denominator
    );

  // Create withdrawal from gov_auth to trigger validation
  const govAuthRewardAccount = RewardAccount.fromCredential(
    {
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(govAuthScript.hash()),
    },
    networkId === 0 ? NetworkId.Testnet : NetworkId.Mainnet
  );

  // Build redeemer for threshold script
  // Threshold contracts typically use simple integer redeemers
  const thresholdRedeemer = PlutusData.newInteger(1n); // 1 for update operation

  // Build the new threshold datum
  const newThresholdDatum: typeof Contracts.MultisigThreshold = newThreshold;

  // Build transaction
  return blaze
    .newTransaction()
    .addInput(thresholdUtxo, thresholdRedeemer)
    .addReferenceInput(mainGovThresholdUtxo) // Required for authorization thresholds
    .addReferenceInput(councilForeverUtxo)
    .addReferenceInput(techAuthForeverUtxo)
    .addReferenceInput(councilTwoStageMainUtxo)
    .addReferenceInput(techAuthTwoStageMainUtxo)
    .addWithdrawal(govAuthRewardAccount, 0n, thresholdRedeemer)
    .provideScript(thresholdScript)
    .provideScript(govAuthScript)
    .provideScript(councilNativeScript)
    .provideScript(techAuthNativeScript)
    .addMint(
      PolicyId(councilPolicyId),
      new Map([[AssetName(""), 1n]])
      // No redeemer for native scripts
    )
    .addMint(
      PolicyId(techAuthPolicyId),
      new Map([[AssetName(""), 1n]])
      // No redeemer for native scripts
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(thresholdAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(thresholdScript.hash()), 1n]]),
        },
        datum: serialize(Contracts.MultisigThreshold, newThresholdDatum).toCore(),
      })
    );
}

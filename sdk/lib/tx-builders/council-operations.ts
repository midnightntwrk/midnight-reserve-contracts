/**
 * Transaction builders for Council operations (member updates, etc.)
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
  RewardAccount,
  NetworkId,
  CredentialType,
  NativeScripts,
  addressFromCredential,
  Credential,
  Hash28ByteBase16,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type * as Contracts from "../../../contract_blueprint";

export interface UpdateCouncilMembersParams {
  blaze: Blaze;
  // Scripts
  councilForeverScript: Script;
  councilTwoStageScript: Script;
  councilLogicScript: Script;
  techAuthForeverScript: Script;
  govAuthScript: Script;
  // UTxOs
  councilForeverUtxo: TransactionUnspentOutput;
  councilTwoStageMainUtxo: TransactionUnspentOutput;
  councilUpdateThresholdUtxo: TransactionUnspentOutput;
  techAuthForeverUtxo: TransactionUnspentOutput;
  // New state
  newSigners: Record<string, string>; // With 8200581c prefix
  // Current state (read from councilForeverUtxo)
  currentSigners: Record<string, string>; // With 8200581c prefix
  currentRound: bigint;
  // Threshold info
  councilThreshold: { numerator: bigint; denominator: bigint };
  techAuthThreshold: { numerator: bigint; denominator: bigint };
  networkId: number;
}

/**
 * Build a transaction to update Council members
 *
 * This performs a "member update" operation which:
 * 1. Spends the Council forever UTxO
 * 2. Creates a new Council forever UTxO with updated signers
 * 3. Keeps the round number the same (member updates don't increment round)
 * 4. Requires authorization via native scripts and withdrawals
 */
export async function buildUpdateCouncilMembersTx(
  params: UpdateCouncilMembersParams
): Promise<TransactionBuilder> {
  const {
    blaze,
    councilForeverScript,
    councilTwoStageScript,
    councilLogicScript,
    techAuthForeverScript,
    govAuthScript,
    councilForeverUtxo,
    councilTwoStageMainUtxo,
    councilUpdateThresholdUtxo,
    techAuthForeverUtxo,
    newSigners,
    currentSigners,
    currentRound,
    councilThreshold,
    techAuthThreshold,
    networkId,
  } = params;

  const Contracts = await import("../../../contract_blueprint");

  // Create new state datum
  const newSignerCount = BigInt(Object.keys(newSigners).length);
  const newCouncilState: typeof Contracts.VersionedMultisig = [
    [newSignerCount, newSigners],
    currentRound, // Keep round the same
  ];

  // Get script addresses
  const councilForeverAddress = addressFromValidator(networkId, councilForeverScript);

  // IMPORTANT: Use extractSignersFromCbor to preserve duplicate keys (weighted voting)
  const { extractSignersFromCbor } = await import("../../../cli/lib/signers");

  // Get raw datum to extract signers with duplicates preserved
  const councilDatum = councilForeverUtxo.output().datum()?.asInlineData();
  const techAuthDatum = techAuthForeverUtxo.output().datum()?.asInlineData();
  if (!councilDatum || !techAuthDatum) {
    throw new Error("Missing inline datum on council or tech-auth UTxO");
  }

  const councilSigners = extractSignersFromCbor(councilDatum);
  const techAuthSigners = extractSignersFromCbor(techAuthDatum);

  // Build native scripts from the multisig state and thresholds
  // This matches the build_native_script function in multisig/script.ak
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
      councilThreshold.numerator,
      councilThreshold.denominator
    );

  const { script: techAuthNativeScript, policyId: techAuthPolicyId } =
    buildNativeScript(
      techAuthSigners,
      techAuthThreshold.numerator,
      techAuthThreshold.denominator
    );

  // Create withdrawal from council_logic to trigger validation
  // The UpgradeState in the two-stage contract contains the logic hash
  const councilLogicRewardAccount = RewardAccount.fromCredential(
    {
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(councilLogicScript.hash()),
    },
    networkId === 0 ? NetworkId.Testnet : NetworkId.Mainnet
  );

  // Build redeemer for Council forever script
  // The redeemer is a map of raw payment hashes (without 8200581c prefix) to SR25519 keys
  // NOTE: For member updates, the redeemer contains the NEW signers (not current)
  const redeemerSigners: Record<string, string> = {};
  for (const [key, value] of Object.entries(newSigners)) {
    const rawHash = key.replace(/^8200581c/i, "");
    redeemerSigners[rawHash] = value;
  }
  const councilRedeemer = serialize(Contracts.PermissionedRedeemer, redeemerSigners);

  // Build transaction
  return blaze
    .newTransaction()
    .addInput(councilForeverUtxo, councilRedeemer)
    .addReferenceInput(councilTwoStageMainUtxo)
    .addReferenceInput(councilUpdateThresholdUtxo)
    .addReferenceInput(techAuthForeverUtxo)
    .addWithdrawal(councilLogicRewardAccount, 0n, councilRedeemer)
    .provideScript(councilForeverScript)
    .provideScript(councilLogicScript)
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
        address: PaymentAddress(councilForeverAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(councilForeverScript.hash()), 1n]]),
        },
        datum: serialize(Contracts.VersionedMultisig, newCouncilState).toCore(),
      })
    );
}

/**
 * Build native scripts matching the Aiken multisig/script.ak encoding
 */

import {
  Script,
  NativeScripts,
  addressFromCredential,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  NetworkId,
} from "@blaze-cardano/core";
import type * as Contracts from "../../../contract_blueprint";

/**
 * Build a native script from multisig datum and threshold
 * This matches the build_native_script function in multisig/script.ak
 * and uses the same approach as cli/utils/transaction.ts:createNativeMultisigScript
 */
export function buildNativeScriptFromMultisig(
  multisigState: typeof Contracts.VersionedMultisig,
  thresholdNumerator: bigint,
  thresholdDenominator: bigint,
  networkId: number
): { script: Script; policyId: string } {
  const [[totalSigners, signers], round] = multisigState;

  // Calculate min_signers (ceil division) - matches Aiken line 37-38
  const minSigners =
    (totalSigners * thresholdNumerator + (thresholdDenominator - 1n)) /
    thresholdDenominator;

  // Build native script using Blaze API
  // The signers are stored with "8200581c" prefix in the datum
  // We need to extract just the payment hash (28 bytes after the prefix)
  const signerScripts = Object.keys(signers).map((key) => {
    // Remove the "8200581c" prefix to get the payment hash
    const paymentHash = key.replace(/^8200581c/i, "");

    // Convert to bech32 address
    const bech32 = addressFromCredential(
      networkId,
      Credential.fromCore({
        type: CredentialType.KeyHash,
        hash: Hash28ByteBase16(paymentHash),
      }),
    ).toBech32();

    // Return a justAddress native script
    return NativeScripts.justAddress(bech32, networkId);
  });

  // Build N-of-M native script
  const nativeScript = NativeScripts.atLeastNOfK(Number(minSigners), ...signerScripts);

  // Wrap in Script and get policy ID
  const script = Script.newNativeScript(nativeScript);
  const policyId = script.hash();

  return { script, policyId };
}

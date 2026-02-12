import {
  addressFromCredential,
  addressFromValidator,
  AssetId,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  Script,
  toHex,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";

/**
 * Query UTxOs for multiple contracts in parallel
 *
 * @param provider - Blaze provider instance
 * @param contracts - Record mapping names to Script objects or script hash strings
 * @param networkId - Network ID (0 for testnet, 1 for mainnet)
 * @returns Record mapping contract names to their UTxO arrays
 *
 * @example
 * const utxos = await getContractUtxos(provider, {
 *   councilForever: councilForeverScript,
 *   councilTwoStage: councilTwoStageScript,
 *   techAuthForever: "abc123...", // hash string also works
 * }, 0);
 */
export async function getContractUtxos(
  provider: Provider,
  contracts: Record<string, Script | string>,
  networkId: number,
): Promise<Record<string, TransactionUnspentOutput[]>> {
  const entries = Object.entries(contracts);

  const results = await Promise.all(
    entries.map(async ([name, scriptOrHash]) => {
      // Handle both Script objects and raw hash strings
      const address =
        typeof scriptOrHash === "string"
          ? addressFromCredential(
              networkId,
              Credential.fromCore({
                type: CredentialType.ScriptHash,
                hash: Hash28ByteBase16(scriptOrHash),
              }),
            )
          : addressFromValidator(networkId, scriptOrHash);

      const utxosSet = await provider.getUnspentOutputs(address);

      return [name, Array.from(utxosSet)] as const;
    }),
  );

  return Object.fromEntries(results);
}

/**
 * Query main and staging UTxOs from a two-stage upgrade contract
 *
 * @param provider - Blaze provider instance
 * @param twoStageScript - The two-stage upgrade script
 * @param networkId - Network ID (0 for testnet, 1 for mainnet)
 * @returns Object containing main UTxO, staging UTxO, and all UTxOs at the address
 * @throws Error if main or staging UTxO cannot be found
 *
 * @example
 * const { main, staging } = await getTwoStageUtxos(
 *   provider,
 *   councilTwoStageScript,
 *   0
 * );
 */
export async function getTwoStageUtxos(
  provider: Provider,
  twoStageScript: Script,
  networkId: number,
): Promise<{
  main: TransactionUnspentOutput;
  staging: TransactionUnspentOutput;
  all: TransactionUnspentOutput[];
}> {
  const twoStageAddress = addressFromValidator(networkId, twoStageScript);
  const utxosSet = await provider.getUnspentOutputs(twoStageAddress);
  const utxos = Array.from(utxosSet);

  const policyId = twoStageScript.hash();
  const mainAssetName = toHex(new TextEncoder().encode("main"));
  const stagingAssetName = toHex(new TextEncoder().encode("staging"));
  const mainAssetId = AssetId(policyId + mainAssetName);
  const stagingAssetId = AssetId(policyId + stagingAssetName);

  const main = utxos.find((utxo) => {
    const assets = utxo.output().amount().multiasset();
    return assets && (assets.get(mainAssetId) ?? 0n) === 1n;
  });

  const staging = utxos.find((utxo) => {
    const assets = utxo.output().amount().multiasset();
    return assets && (assets.get(stagingAssetId) ?? 0n) === 1n;
  });

  if (!main || !staging) {
    throw new Error(
      `Could not find two-stage UTxOs at ${twoStageAddress.toBech32()} ` +
        `(main: ${!!main}, staging: ${!!staging})`,
    );
  }

  return { main, staging, all: utxos };
}

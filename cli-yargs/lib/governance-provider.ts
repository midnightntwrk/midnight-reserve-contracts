import {
  addressFromValidator,
  addressFromCredential,
  AssetId,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  HexBlob,
  PlutusData,
  PlutusDataKind,
  Script,
  toHex,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";
import type { ContractInstances } from "./contracts";
import { findScriptByHash, getTwoStageContracts } from "./contracts";

export interface UpgradeState {
  logicHash: string;
  mitigationLogicHash: string;
  authHash: string;
  logicRound: number;
}

/**
 * Query UTxOs for multiple contracts in parallel.
 */
export async function getContractUtxos(
  provider: Provider,
  contracts: Record<string, Script | string>,
  networkId: number,
): Promise<Record<string, TransactionUnspentOutput[]>> {
  const entries = Object.entries(contracts);

  const results = await Promise.all(
    entries.map(async ([name, scriptOrHash]) => {
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
 * Query main and staging UTxOs from a two-stage upgrade contract.
 * Finds UTxOs by NFT token name ("main" or "staging") minted by the two-stage script.
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

/**
 * Extracts the UpgradeState from a two-stage datum.
 *
 * UpgradeState is a 6-element tuple:
 *   [logicHash, mitigationLogicHash, authHash, mitigationAuthHash, logicRound, authRound]
 *
 * Indices: 0=logicHash(bytes), 1=mitigationLogicHash(bytes), 2=authHash(bytes),
 *          3=mitigationAuthHash(bytes), 4=logicRound(int), 5=authRound(int)
 */
export function parseUpgradeState(
  inlineDatumCbor: string,
): UpgradeState | null {
  try {
    const plutusData = PlutusData.fromCbor(HexBlob(inlineDatumCbor));
    const items =
      plutusData.asList() ?? plutusData.asConstrPlutusData()?.getData();
    if (!items || items.getLength() < 5) return null;

    const logicField = items.get(0);
    const mitigationLogicField = items.get(1);
    const authField = items.get(2);
    const logicRoundField = items.get(4);

    if (
      logicField.getKind() !== PlutusDataKind.Bytes ||
      authField.getKind() !== PlutusDataKind.Bytes
    ) {
      return null;
    }

    const logicHash = Buffer.from(logicField.asBoundedBytes()!).toString("hex");
    const mitigationLogicHash =
      mitigationLogicField.getKind() === PlutusDataKind.Bytes
        ? Buffer.from(mitigationLogicField.asBoundedBytes()!).toString("hex")
        : "";
    const authHash = Buffer.from(authField.asBoundedBytes()!).toString("hex");
    const logicRound = Number(logicRoundField.asInteger() ?? 0n);

    return { logicHash, mitigationLogicHash, authHash, logicRound };
  } catch {
    return null;
  }
}

/**
 * Resolves a logic script from its hash using the loaded blueprint.
 */
export function resolveLogicScript(
  logicHash: string,
  env?: string,
  useBuild?: boolean,
): Script | null {
  return findScriptByHash(logicHash, env, useBuild);
}

/**
 * High-level: selects main/staging UTxO, parses UpgradeState, and resolves logic script.
 */
export async function resolveUpgradeLogic(
  provider: Provider,
  networkId: number,
  validatorName: string,
  track: "main" | "staging" = "main",
  env?: string,
  useBuild?: boolean,
): Promise<{
  utxo: TransactionUnspentOutput;
  upgradeState: UpgradeState;
  logicScript: Script | null;
}> {
  const { twoStage } = getTwoStageContracts(validatorName, env, useBuild);

  const { main, staging } = await getTwoStageUtxos(
    provider,
    twoStage.Script,
    networkId,
  );

  const utxo = track === "main" ? main : staging;
  const datum = utxo.output().datum()?.asInlineData();
  if (!datum) {
    throw new Error(`No inline datum on ${track} UTxO for ${validatorName}`);
  }

  const upgradeState = parseUpgradeState(datum.toCbor());
  if (!upgradeState) {
    throw new Error(
      `Could not parse UpgradeState from ${track} datum for ${validatorName}`,
    );
  }

  const logicScript = resolveLogicScript(upgradeState.logicHash, env, useBuild);

  return { utxo, upgradeState, logicScript };
}

/**
 * Queries all governance contract UTxOs for an environment.
 * Returns UTxOs for all core governance contracts.
 */
export async function getGovernanceUtxos(
  provider: Provider,
  contracts: ContractInstances,
  networkId: number,
): Promise<Record<string, TransactionUnspentOutput[]>> {
  const contractMap: Record<string, Script> = {
    councilForever: contracts.councilForever.Script,
    councilTwoStage: contracts.councilTwoStage.Script,
    techAuthForever: contracts.techAuthForever.Script,
    techAuthTwoStage: contracts.techAuthTwoStage.Script,
    reserveForever: contracts.reserveForever.Script,
    reserveTwoStage: contracts.reserveTwoStage.Script,
    icsForever: contracts.icsForever.Script,
    icsTwoStage: contracts.icsTwoStage.Script,
    federatedOpsForever: contracts.federatedOpsForever.Script,
    federatedOpsTwoStage: contracts.federatedOpsTwoStage.Script,
    termsAndConditionsForever: contracts.termsAndConditionsForever.Script,
    termsAndConditionsTwoStage: contracts.termsAndConditionsTwoStage.Script,
  };

  return getContractUtxos(provider, contractMap, networkId);
}

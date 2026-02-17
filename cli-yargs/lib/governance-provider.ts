import {
  addressFromValidator,
  addressFromCredential,
  AssetId,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  HexBlob,
  NetworkId,
  PlutusData,
  PlutusDataKind,
  RewardAccount,
  Script,
  toHex,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";
import { getCardanoNetwork } from "./types";
import { getEnvVar } from "./config";

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
 *   [logic, mitigationLogic, auth, mitigationAuth, round, logicRound]
 *
 * Indices: 0=logic(bytes), 1=mitigationLogic(bytes), 2=auth(bytes),
 *          3=mitigationAuth(bytes), 4=round(int), 5=logicRound(int)
 */
export function parseUpgradeState(
  inlineDatumCbor: string,
): UpgradeState | null {
  try {
    const plutusData = PlutusData.fromCbor(HexBlob(inlineDatumCbor));
    const items =
      plutusData.asList() ?? plutusData.asConstrPlutusData()?.getData();
    if (!items || items.getLength() < 6) return null;

    const logicField = items.get(0);
    const mitigationLogicField = items.get(1);
    const authField = items.get(2);
    // UpgradeState: [logic, mitigation_logic, auth, mitigation_auth, round, logic_round]
    // Index 5 is logic_round (not index 4, which is round)
    const logicRoundField = items.get(5);

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
 * Checks if a reward account (stake credential) is registered on-chain via Blockfrost.
 * Returns true if registered, false if not.
 * Throws if the provider is not Blockfrost (only Blockfrost REST API is supported).
 */
async function isRewardAccountRegistered(
  rewardAccount: RewardAccount,
  environment: string,
): Promise<boolean> {
  const cardanoNetwork = getCardanoNetwork(environment);
  if (!cardanoNetwork) return true; // emulator — skip check, assume registered

  const apiKeyVar = `BLOCKFROST_${cardanoNetwork.toUpperCase()}_API_KEY`;
  const apiKey = getEnvVar(apiKeyVar);
  const baseUrl = `https://cardano-${cardanoNetwork}.blockfrost.io/api/v0`;

  const response = await fetch(`${baseUrl}/accounts/${rewardAccount}`, {
    headers: { project_id: apiKey },
  });

  if (response.status === 404) return false;
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Blockfrost auth error (${response.status}) checking reward account ${rewardAccount}. ` +
        `Verify ${apiKeyVar} is set correctly.`,
    );
  }
  if (!response.ok) return true; // treat other errors as unknown — skip check, let tx submission surface the real error

  // Account exists (200 OK) means registered. Blockfrost's `active` field
  // means "actively delegated", not "registered" — ignore it here.
  return true;
}

/**
 * Checks that all reward accounts in the list are registered on-chain.
 * Throws with a clear error message listing unregistered accounts and how to fix them.
 */
export async function ensureRewardAccountsRegistered(
  accounts: {
    label: string;
    rewardAccount: RewardAccount;
    scriptHash: string;
  }[],
  environment: string,
): Promise<void> {
  const results = await Promise.all(
    accounts.map(async (a) => ({
      ...a,
      registered: await isRewardAccountRegistered(a.rewardAccount, environment),
    })),
  );

  const unregistered = results.filter((r) => !r.registered);
  if (unregistered.length > 0) {
    const details = unregistered
      .map((r) => `  - ${r.label}: ${r.scriptHash} (${r.rewardAccount})`)
      .join("\n");
    throw new Error(
      `The following reward accounts are not registered on-chain:\n${details}\n\n` +
        `Register them first with:\n` +
        `  bun cli-yargs/index.ts register-gov-auth -n ${environment}\n` +
        `Or for v2 logic scripts, register the stake credential manually.`,
    );
  }
}

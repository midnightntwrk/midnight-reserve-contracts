import { HexBlob, PlutusData, PlutusDataKind } from "@blaze-cardano/core";

/**
 * Fetch data from the Blockfrost REST API.
 * Returns parsed JSON, or null if the resource was not found (404).
 */
export async function blockfrostFetch(
  baseUrl: string,
  apiKey: string,
  path: string,
): Promise<unknown> {
  const resp = await fetch(`${baseUrl}${path}`, {
    headers: { project_id: apiKey },
  });
  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok) {
    throw new Error(
      `Blockfrost ${path} failed: ${resp.status} ${resp.statusText}`,
    );
  }
  return resp.json();
}

/**
 * Parse an UpgradeState datum from inline CBOR hex.
 * Returns { logicHash, authHash } or null if parsing fails.
 *
 * UpgradeState is a 3+ element tuple: [logic(bytes), mitigationLogic, auth(bytes), ...]
 */
export function parseUpgradeStateDatum(
  inlineDatumCbor: string,
): { logicHash: string; authHash: string } | null {
  try {
    const plutusData = PlutusData.fromCbor(HexBlob(inlineDatumCbor));
    const items =
      plutusData.asList() ?? plutusData.asConstrPlutusData()?.getData();
    if (!items || items.getLength() < 3) return null;

    const logicField = items.get(0);
    const authField = items.get(2);

    if (
      logicField.getKind() !== PlutusDataKind.Bytes ||
      authField.getKind() !== PlutusDataKind.Bytes
    ) {
      return null;
    }

    const logicHash = Buffer.from(logicField.asBoundedBytes()!).toString("hex");
    const authHash = Buffer.from(authField.asBoundedBytes()!).toString("hex");

    return { logicHash, authHash };
  } catch {
    return null;
  }
}

const BLOCKFROST_NETWORK_NAME: Record<string, string> = {
  preview: "cardano-preview",
  preprod: "cardano-preprod",
  mainnet: "cardano-mainnet",
};

/**
 * Build the Blockfrost REST API base URL for a given Cardano network name
 * (preview | preprod | mainnet).
 */
export function getBlockfrostBaseUrl(cardanoNetwork: string): string {
  const host = BLOCKFROST_NETWORK_NAME[cardanoNetwork];
  if (!host) {
    throw new Error(
      `Unknown Cardano network for Blockfrost: ${cardanoNetwork}`,
    );
  }
  return `https://${host}.blockfrost.io/api/v0`;
}

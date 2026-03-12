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

export interface BlockfrostAmount {
  unit: string;
  quantity: string;
}

export interface BlockfrostAddressUtxo {
  tx_hash: string;
  tx_index: number;
  output_index: number;
  amount: BlockfrostAmount[];
  inline_datum: string | null;
  data_hash: string | null;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidAddressUtxoResponse(
  responsePath: string,
  detail: string,
  entryIndex?: number,
  fieldPath?: string,
): never {
  const location =
    entryIndex === undefined
      ? responsePath
      : `${responsePath}[${entryIndex}]${fieldPath ? `.${fieldPath}` : ""}`;
  throw new Error(`Invalid Blockfrost ${location} response: ${detail}`);
}

function requireString(
  value: unknown,
  responsePath: string,
  entryIndex: number,
  fieldPath: string,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    invalidAddressUtxoResponse(
      responsePath,
      `expected ${fieldName} to be a string`,
      entryIndex,
      fieldPath,
    );
  }
  return value;
}

function requireInteger(
  value: unknown,
  responsePath: string,
  entryIndex: number,
  fieldPath: string,
  fieldName: string,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    invalidAddressUtxoResponse(
      responsePath,
      `expected ${fieldName} to be an integer`,
      entryIndex,
      fieldPath,
    );
  }
  return value;
}

function requireNullableString(
  value: unknown,
  responsePath: string,
  entryIndex: number,
  fieldPath: string,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    invalidAddressUtxoResponse(
      responsePath,
      `expected ${fieldName} to be a string or null`,
      entryIndex,
      fieldPath,
    );
  }
  return value;
}

export function parseBlockfrostAddressUtxos(
  value: unknown,
  responsePath = "/addresses/.../utxos",
): BlockfrostAddressUtxo[] {
  if (!Array.isArray(value)) {
    invalidAddressUtxoResponse(responsePath, "expected an array");
  }

  return value.map((entry, entryIndex) => {
    if (!isObjectLike(entry)) {
      invalidAddressUtxoResponse(
        responsePath,
        "expected an object",
        entryIndex,
      );
    }

    const amount = entry.amount;
    if (!Array.isArray(amount)) {
      invalidAddressUtxoResponse(
        responsePath,
        "expected amount to be an array",
        entryIndex,
        "amount",
      );
    }

    const parsedAmount = amount.map((amountEntry, amountIndex) => {
      if (!isObjectLike(amountEntry)) {
        invalidAddressUtxoResponse(
          responsePath,
          "expected amount entry to be an object",
          entryIndex,
          `amount[${amountIndex}]`,
        );
      }

      return {
        unit: requireString(
          amountEntry.unit,
          responsePath,
          entryIndex,
          `amount[${amountIndex}].unit`,
          "unit",
        ),
        quantity: requireString(
          amountEntry.quantity,
          responsePath,
          entryIndex,
          `amount[${amountIndex}].quantity`,
          "quantity",
        ),
      };
    });

    return {
      tx_hash: requireString(
        entry.tx_hash,
        responsePath,
        entryIndex,
        "tx_hash",
        "tx_hash",
      ),
      tx_index: requireInteger(
        entry.tx_index,
        responsePath,
        entryIndex,
        "tx_index",
        "tx_index",
      ),
      output_index: requireInteger(
        entry.output_index,
        responsePath,
        entryIndex,
        "output_index",
        "output_index",
      ),
      amount: parsedAmount,
      inline_datum: requireNullableString(
        entry.inline_datum,
        responsePath,
        entryIndex,
        "inline_datum",
        "inline_datum",
      ),
      data_hash: requireNullableString(
        entry.data_hash,
        responsePath,
        entryIndex,
        "data_hash",
        "data_hash",
      ),
    };
  });
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

import { Transaction, HexBlob, TxCBOR } from "@blaze-cardano/core";
import type { TransactionOutput } from "../types";
import { blockfrostFetch } from "../blockfrost";
import { formatLovelaceToAda } from "../output";

export interface ResolvedInput {
  txHash: string;
  index: number;
  address: string;
  lovelace: string;
  ada: string;
  tokens: { policyId: string; assetName: string; quantity: string }[];
  inlineDatum: string | null;
  isReferenceInput: boolean;
}

/**
 * Resolve all tx inputs and reference inputs via Blockfrost.
 * Fetches the consumed UTxO data for each input to get address, value, datum.
 */
export async function resolveInputs(
  txJson: TransactionOutput,
  baseUrl: string,
  apiKey: string,
): Promise<ResolvedInput[]> {
  const tx = Transaction.fromCbor(TxCBOR(HexBlob(txJson.cborHex)));
  const body = tx.body();
  const results: ResolvedInput[] = [];

  const spendInputs = [...body.inputs().values()].map((i) => ({
    txHash: i.transactionId(),
    index: Number(i.index()),
    isReferenceInput: false,
  }));

  const refInputsRaw = body.referenceInputs();
  const refInputs = refInputsRaw
    ? [...refInputsRaw.values()].map((i) => ({
        txHash: i.transactionId(),
        index: Number(i.index()),
        isReferenceInput: true,
      }))
    : [];

  const allInputs = [...spendInputs, ...refInputs];

  // Group by txHash to minimize Blockfrost calls
  const byTxHash = new Map<string, typeof allInputs>();
  for (const input of allInputs) {
    const group = byTxHash.get(input.txHash) ?? [];
    group.push(input);
    byTxHash.set(input.txHash, group);
  }

  for (const [txHash, inputs] of byTxHash) {
    const utxosResult = await blockfrostFetch(
      baseUrl,
      apiKey,
      `/txs/${txHash}/utxos`,
    );
    if (!utxosResult) continue;
    const utxos = utxosResult as {
      outputs: Array<{
        address: string;
        amount: { unit: string; quantity: string }[];
        output_index: number;
        inline_datum: string | null;
      }>;
    };

    for (const input of inputs) {
      const output = utxos.outputs.find((o) => o.output_index === input.index);
      if (!output) continue;

      const lovelaceAmt = output.amount.find((a) => a.unit === "lovelace");
      const lovelace = lovelaceAmt?.quantity ?? "0";
      const tokens = output.amount
        .filter((a) => a.unit !== "lovelace" && a.unit.length >= 56)
        .map((a) => ({
          policyId: a.unit.slice(0, 56),
          assetName: a.unit.slice(56),
          quantity: a.quantity,
        }));

      results.push({
        txHash: input.txHash,
        index: input.index,
        address: output.address,
        lovelace,
        ada: formatLovelaceToAda(BigInt(lovelace)),
        tokens,
        inlineDatum: output.inline_datum ?? null,
        isReferenceInput: input.isReferenceInput,
      });
    }
  }

  return results;
}

/** UTxO references and lookup by reference. */
import {
  type TransactionInput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type { TxHash, TxIndex } from "../input";

/** A UTxO reference as `txId#index`. */
export const refOf = (input: TransactionInput): string =>
  `${input.transactionId()}#${input.index()}`;

/** The UTxO with this reference among `utxos`. */
export function findUtxoByTxRef(
  utxos: readonly TransactionUnspentOutput[],
  txHash: TxHash,
  txIndex: TxIndex,
): TransactionUnspentOutput | undefined {
  return utxos.find(
    (utxo) =>
      utxo.input().transactionId() === txHash &&
      utxo.input().index() === BigInt(txIndex),
  );
}

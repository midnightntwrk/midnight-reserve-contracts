/**
 * Transaction building blocks shared by the commands: the upgrade state, UTxO
 * references and inline datum decoding. inlineDatum and decodeInlineDatum
 * return Either.
 */
import {
  PlutusData,
  type TransactionInput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Either } from "effect";
import type { TxHash, TxIndex } from "../input";
import { DatumParseError } from "../errors";
import type * as Contracts from "../../contract_blueprint";

export function createUpgradeState(
  logicScriptHash: string,
  govAuthScriptHash: string,
): Contracts.UpgradeState {
  return [logicScriptHash, "", govAuthScriptHash, "", 0n, 0n];
}

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

/** The inline datum of a UTxO; a missing one is a DatumParseError for `what`. */
export const inlineDatum = (
  utxo: TransactionUnspentOutput,
  what: string,
): Either.Either<PlutusData, DatumParseError> =>
  Either.fromNullable(
    utxo.output().datum()?.asInlineData(),
    () =>
      new DatumParseError({
        what,
        cbor: "",
        reason: "UTxO has no inline datum",
      }),
  );

/** Decode a datum; a throwing decoder is a DatumParseError for `what`. */
export const decodeDatum = <T>(
  data: PlutusData,
  what: string,
  decode: (data: PlutusData) => T,
): Either.Either<T, DatumParseError> =>
  Either.try({
    try: () => decode(data),
    catch: (cause) =>
      new DatumParseError({
        what,
        cbor: data.toCbor(),
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
  });

/** Decode the inline datum of a UTxO; a missing datum or a throwing decoder is a DatumParseError. */
export const decodeInlineDatum = <T>(
  utxo: TransactionUnspentOutput,
  what: string,
  decode: (data: PlutusData) => T,
): Either.Either<T, DatumParseError> =>
  Either.flatMap(inlineDatum(utxo, what), (data) =>
    decodeDatum(data, what, decode),
  );

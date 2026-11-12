/** Inline datum decoding; every function returns Either with a DatumParseError. */
import { PlutusData, TransactionUnspentOutput } from "@blaze-cardano/core";
import { Either } from "effect";
import { DatumParseError } from "../errors";

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

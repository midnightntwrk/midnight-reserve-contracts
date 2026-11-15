/** Datum codecs: a UTxO's inline datum decoded through a blueprint type. */
import type { PlutusData, TransactionUnspentOutput } from "@blaze-cardano/core";
import { Effect } from "effect";
import { DatumParseError } from "./errors";

/** Decode the inline datum of a UTxO; a missing datum or a throwing decoder is a DatumParseError for `what`. */
export const decodeInlineDatum = <T>(
  utxo: TransactionUnspentOutput,
  what: string,
  decode: (data: PlutusData) => T,
): Effect.Effect<T, DatumParseError> =>
  Effect.gen(function* () {
    const data = utxo.output().datum()?.asInlineData();
    if (data === undefined) {
      return yield* new DatumParseError({
        what,
        cbor: "",
        reason: "UTxO has no inline datum",
      });
    }
    return yield* Effect.try({
      try: () => decode(data),
      catch: (cause) =>
        new DatumParseError({
          what,
          cbor: data.toCbor(),
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  });

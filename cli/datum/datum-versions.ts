/** The logic_round of a versioned forever datum; UpgradeState (two-stage) belongs to governance-provider.ts. */
import type { PlutusData } from "@blaze-cardano/core";
import { Either } from "effect";
import { DatumParseError } from "../errors";

/** The logic_round of a forever datum: the last element of its top-level list. */
export const logicRound = (
  cbor: PlutusData,
): Either.Either<number, DatumParseError> => {
  const fail = (reason: string) =>
    Either.left(
      new DatumParseError({ what: "logic_round", cbor: cbor.toCbor(), reason }),
    );
  const list = cbor.asList();
  if (!list || list.getLength() < 2) {
    return fail("datum is not a list with >= 2 elements");
  }
  const round = list.get(list.getLength() - 1).asInteger();
  if (round === undefined) {
    return fail("last element is not an integer");
  }
  return Either.right(Number(round));
};

/** The latest multisig and terms datum format. */
const LATEST_DATUM_ROUND = 1;

/** The logic_round a multisig or terms change writes: the promote counter capped at the latest format, since a promote raises the counter without a format change. */
export const datumRoundOf = (logicRound: number): number =>
  Math.min(logicRound, LATEST_DATUM_ROUND);

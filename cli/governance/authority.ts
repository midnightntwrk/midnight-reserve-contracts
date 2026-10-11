/** The signer and threshold datums of a multisig authority's forever and threshold UTxOs. */
import type { TransactionUnspentOutput } from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { Either } from "effect";
import * as Contracts from "../../contract_blueprint";
import { decodeSigners, type Signers } from "../datum/signers";
import { decodeDatum, inlineDatum } from "../datum/inline";
import { type AuthorityThreshold, authorityThreshold } from "./threshold";
import { DatumParseError } from "../errors";

/** The current signers in a multisig authority's forever UTxO. */
export const signersAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<Signers, DatumParseError> =>
  Either.flatMap(inlineDatum(utxo, "VersionedMultisig"), decodeSigners);

/** The fractions of a threshold UTxO's MultisigThreshold datum, each checked. */
export const thresholdAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<AuthorityThreshold, DatumParseError> =>
  Either.flatMap(inlineDatum(utxo, "MultisigThreshold"), (data) =>
    Either.flatMap(
      decodeDatum(data, "MultisigThreshold", (d) =>
        parse(Contracts.MultisigThreshold, d),
      ),
      (datum) =>
        Either.mapLeft(
          authorityThreshold(datum),
          (reason) =>
            new DatumParseError({
              what: "MultisigThreshold",
              cbor: data.toCbor(),
              reason,
            }),
        ),
    ),
  );

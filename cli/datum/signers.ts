/**
 * Governance signers: parsing the SIGNERS env values, and the CBOR encodings
 * of VersionedMultisig and PermissionedRedeemer that keep duplicate keys
 * (Aiken's un_map_data preserves them, JavaScript Records do not).
 */
import {
  CborReader,
  CborReaderState,
  CborWriter,
  Ed25519PrivateNormalKeyHex,
  fromHex,
  type HexBlob,
  PlutusData,
  type PlutusList,
  toHex,
} from "@blaze-cardano/core";
import { Array as Arr, Either, Redacted } from "effect";
import { DatumParseError, describeCause, InputParseError } from "../errors";

/** A council or tech-auth member: payment key hash and sr25519 key. */
export interface Signer {
  paymentHash: string;
  sr25519Key: string;
}

/** At least one signer; decoders and parsers reject an empty list at the boundary. */
export type Signers = Arr.NonEmptyReadonlyArray<Signer>;

const HEX_RE = /^[0-9a-fA-F]+$/;

const issue = (source: string, ...issues: string[]) =>
  Either.left(new InputParseError({ source, issues }));

const checkSignerHex = (
  source: string,
  paymentHash: string,
  sr25519Key: string,
): Either.Either<Signer, InputParseError> =>
  paymentHash.length !== 56 || !HEX_RE.test(paymentHash)
    ? issue(
        source,
        `payment hash must be 56 hex characters (28 bytes), got '${paymentHash}'`,
      )
    : !HEX_RE.test(sr25519Key)
      ? issue(source, `sr25519 key must be valid hex, got '${sr25519Key}'`)
      : Either.right({
          paymentHash: paymentHash.toLowerCase(),
          sr25519Key: sr25519Key.toLowerCase(),
        });

/** Parse "hash:key,hash:key": blank entries skipped, duplicates kept with their weight. */
export const parseSigners = (
  source: string,
  value: string | undefined,
): Either.Either<Signers, InputParseError> => {
  if (!value) return issue(source, "environment variable is required");
  return Either.flatMap(
    Either.all(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => {
          const fields = entry.split(":").map((field) => field.trim());
          const [paymentHash = "", sr25519Key = ""] = fields;
          return fields.length !== 2
            ? issue(
                source,
                `signer entry '${entry}' must contain exactly one ':' delimiter`,
              )
            : !paymentHash || !sr25519Key
              ? issue(
                  source,
                  `signer entry '${entry}' must include non-empty payment hash and sr25519 key`,
                )
              : checkSignerHex(source, paymentHash, sr25519Key);
        }),
    ),
    (signers) =>
      Arr.isNonEmptyReadonlyArray(signers)
        ? Either.right(signers)
        : issue(source, "no signer entries"),
  );
};

/** An Ed25519 private key: 64 hex characters, checked once where it is read. */
export type PrivateKey = Ed25519PrivateNormalKeyHex;

const PRIVATE_KEY_RE = /^[0-9a-fA-F]{64}$/;

/** One private key; the reason for anything but 64 hex characters never quotes the key. */
export const parsePrivateKey = (
  text: string,
): Either.Either<PrivateKey, string> =>
  text.length !== 64
    ? Either.left(`a private key must be 64 hex characters, not ${text.length}`)
    : PRIVATE_KEY_RE.test(text)
      ? Either.right(Ed25519PrivateNormalKeyHex(text))
      : Either.left("a private key must be hex");

/** The comma-separated private keys of a secret, blanks dropped; at least one, each checked. */
export const parsePrivateKeys = (
  secret: Redacted.Redacted,
): Either.Either<Arr.NonEmptyReadonlyArray<PrivateKey>, string> =>
  Either.flatMap(
    Either.all(
      Redacted.value(secret)
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
        .map(parsePrivateKey),
    ),
    (keys) =>
      Arr.isNonEmptyReadonlyArray(keys)
        ? Either.right(keys)
        : Either.left("resolved to zero keys"),
  );

const multisigError = (datum: PlutusData) => (reason: string) =>
  new DatumParseError({
    what: "VersionedMultisig",
    cbor: datum.toCbor(),
    reason,
  });

/** The Multisig tuple [total_signers, signers] of a VersionedMultisig [multisig, logic_round]. */
const multisigTuple = (
  datum: PlutusData,
): Either.Either<PlutusList, DatumParseError> => {
  const error = multisigError(datum);
  const outerList = datum.asList();
  if (!outerList || outerList.getLength() !== 2) {
    return Either.left(error("expected a list of 2 elements"));
  }
  const tuple = outerList.get(0).asList();
  return tuple && tuple.getLength() === 2
    ? Either.right(tuple)
    : Either.left(error("the Multisig tuple should have 2 items"));
};

/** The signers of a VersionedMultisig's signer map, duplicates included (the map CBOR is read directly); at least one. */
const signersIn = (
  datum: PlutusData,
  map: PlutusData,
): Either.Either<Signers, DatumParseError> => {
  const error = multisigError(datum);
  if (!map.asMap()) return Either.left(error("expected a map of signers"));
  return Either.flatMap(
    Either.mapLeft(readSignerMap(map.toCbor()), error),
    (signers) =>
      Arr.isNonEmptyReadonlyArray(signers)
        ? Either.right(signers)
        : Either.left(error("no signers in the map")),
  );
};

/** The signers of a VersionedMultisig datum, duplicates included; at least one. */
export const decodeSigners = (
  datum: PlutusData,
): Either.Either<Signers, DatumParseError> =>
  Either.flatMap(multisigTuple(datum), (tuple) =>
    signersIn(datum, tuple.get(1)),
  );

/** The entries of a CBOR map of bytes -> bytes, duplicates kept; keys are "8200581c" + payment hash. */
const readSignerMap = (cbor: HexBlob): Either.Either<Signer[], string> =>
  Either.try({
    try: () => {
      const reader = new CborReader(cbor);
      reader.readStartMap();
      const signers: Signer[] = [];
      while (reader.peekState() !== CborReaderState.EndMap) {
        const key = toHex(reader.readByteString());
        const value = toHex(reader.readByteString());
        signers.push({ paymentHash: key.slice(8), sr25519Key: value });
      }
      return signers;
    },
    catch: describeCause,
  });

/** Write `signers` as a definite map of bytes -> bytes, duplicate keys kept; `key` gives each key's hex. */
const writeSignerMap = (
  writer: CborWriter,
  signers: readonly Signer[],
  key: (signer: Signer) => string,
): CborWriter =>
  signers.reduce(
    (w, s) =>
      w.writeByteString(fromHex(key(s))).writeByteString(fromHex(s.sr25519Key)),
    writer.writeStartMap(signers.length),
  );

/** VersionedMultisig `[[total_signers, signers], round]` as CBOR with duplicate keys kept. */
export const encodeMultisigState = (
  signers: readonly Signer[],
  round: bigint = 0n,
  totalSigners: bigint = BigInt(signers.length),
): Either.Either<PlutusData, InputParseError> =>
  signers.length > 255
    ? issue("signers", "too many signers for simple CBOR encoding")
    : totalSigners > 255n
      ? issue("signers", "total signers too large for simple encoding")
      : round > 23n
        ? issue("signers", "round value too large for simple encoding")
        : Either.right(
            PlutusData.fromCbor(
              writeSignerMap(
                new CborWriter()
                  .writeStartArray()
                  .writeStartArray()
                  .writeInt(totalSigners),
                signers,
                (s) => `8200581c${s.paymentHash}`,
              )
                .writeEndArray()
                .writeInt(round)
                .writeEndArray()
                .encodeAsHex(),
            ),
          );

/** PermissionedRedeemer map `payment hash -> sr25519 key` as CBOR with duplicate keys kept. */
export const encodeRedeemerMap = (
  signers: readonly Signer[],
): Either.Either<PlutusData, InputParseError> =>
  signers.length > 255
    ? issue("signers", "too many signers for simple CBOR encoding")
    : Either.right(
        PlutusData.fromCbor(
          writeSignerMap(
            new CborWriter(),
            signers,
            (s) => s.paymentHash,
          ).encodeAsHex(),
        ),
      );

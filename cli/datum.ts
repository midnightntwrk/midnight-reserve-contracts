/**
 * Datum codecs: a UTxO's inline datum; the governance signers'
 * VersionedMultisig and PermissionedRedeemer, written and read as CBOR by
 * hand so that duplicate keys survive (Aiken's un_map_data keeps them, a
 * JavaScript Record does not); the terms and FederatedOps datums; and the
 * logic_round a versioned datum carries.
 */
import {
  CborReader,
  CborReaderState,
  CborWriter,
  fromHex,
  type HexBlob,
  PlutusData,
  toHex,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import { Array as Arr, Effect, Result } from "effect";
import * as Contracts from "../contract_blueprint";
import { DatumParseError, InputParseError } from "./errors";
import type { PermissionedCandidate, Signer, Signers } from "./input";

/** The inline datum of a UTxO; a missing one is a DatumParseError for `what`. */
export const inlineDatum = (
  utxo: TransactionUnspentOutput,
  what: string,
): Effect.Effect<PlutusData, DatumParseError> => {
  const data = utxo.output().datum()?.asInlineData();
  return data === undefined
    ? Effect.fail(
        new DatumParseError({
          what,
          cbor: "",
          reason: "UTxO has no inline datum",
        }),
      )
    : Effect.succeed(data);
};

/** Decode a datum; a throwing decoder is a DatumParseError for `what`. */
export const decodeDatum = <T>(
  data: PlutusData,
  what: string,
  decode: (data: PlutusData) => T,
): Effect.Effect<T, DatumParseError> =>
  Effect.try({
    try: () => decode(data),
    catch: (cause) =>
      new DatumParseError({
        what,
        cbor: data.toCbor(),
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
  });

/** Decode the inline datum of a UTxO; a missing datum or a throwing decoder is a DatumParseError for `what`. */
export const decodeInlineDatum = <T>(
  utxo: TransactionUnspentOutput,
  what: string,
  decode: (data: PlutusData) => T,
): Effect.Effect<T, DatumParseError> =>
  Effect.flatMap(inlineDatum(utxo, what), (data) =>
    decodeDatum(data, what, decode),
  );

// logic_round

/** The logic_round of a versioned forever datum: the last element of its top-level list. */
export const datumLogicRound = (
  data: PlutusData,
): Result.Result<number, DatumParseError> => {
  const fail = (reason: string) =>
    Result.fail(
      new DatumParseError({ what: "logic_round", cbor: data.toCbor(), reason }),
    );
  const list = data.asList();
  if (list === undefined || list.getLength() < 2) {
    return fail("datum is not a list with >= 2 elements");
  }
  const round = list.get(list.getLength() - 1).asInteger();
  return round === undefined
    ? fail("last element is not an integer")
    : Result.succeed(Number(round));
};

/** The latest multisig and terms datum format. */
const LATEST_DATUM_ROUND = 1;

/** The logic_round a multisig or terms change writes: the promote counter capped at the latest format, since a promote raises the counter without a format change. */
export const datumRoundOf = (logicRound: number): number =>
  Math.min(logicRound, LATEST_DATUM_ROUND);

// signers

const multisigError = (datum: PlutusData) => (reason: string) =>
  new DatumParseError({
    what: "VersionedMultisig",
    cbor: datum.toCbor(),
    reason,
  });

/** The entries of a CBOR map of bytes to bytes, duplicates kept; each key is "8200581c" and the payment hash. */
const readSignerMap = (cbor: HexBlob): Signer[] => {
  const reader = new CborReader(cbor);
  reader.readStartMap();
  const signers: Signer[] = [];
  while (reader.peekState() !== CborReaderState.EndMap) {
    const key = toHex(reader.readByteString());
    const value = toHex(reader.readByteString());
    signers.push({ paymentHash: key.slice(8), sr25519Key: value });
  }
  return signers;
};

/** The signers of a VersionedMultisig [[total_signers, signers], logic_round], duplicates included; at least one. */
export const decodeSigners = (
  datum: PlutusData,
): Effect.Effect<Signers, DatumParseError> =>
  Effect.gen(function* () {
    const error = multisigError(datum);
    const outer = datum.asList();
    if (outer === undefined || outer.getLength() !== 2) {
      return yield* error("expected a list of 2 elements");
    }
    const tuple = outer.get(0).asList();
    if (tuple === undefined || tuple.getLength() !== 2) {
      return yield* error("the Multisig tuple should have 2 items");
    }
    const map = tuple.get(1);
    if (map.asMap() === undefined) {
      return yield* error("expected a map of signers");
    }
    const signers = yield* Effect.try({
      try: () => readSignerMap(map.toCbor()),
      catch: (cause) =>
        error(cause instanceof Error ? cause.message : String(cause)),
    });
    return Arr.isReadonlyArrayNonEmpty(signers)
      ? signers
      : yield* error("no signers in the map");
  });

const signersIssue = (issue: string) =>
  Result.fail(new InputParseError({ source: "signers", issues: [issue] }));

/** Write `signers` as a definite map of bytes to bytes, duplicate keys kept; `key` gives each key's hex. */
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

/** VersionedMultisig [[total_signers, signers], round] with duplicate keys kept. */
export const encodeMultisigState = (
  signers: readonly Signer[],
  round: bigint = 0n,
  totalSigners: bigint = BigInt(signers.length),
): Result.Result<PlutusData, InputParseError> =>
  signers.length > 255
    ? signersIssue("too many signers for simple CBOR encoding")
    : totalSigners > 255n
      ? signersIssue("total signers too large for simple encoding")
      : round > 23n
        ? signersIssue("round value too large for simple encoding")
        : Result.succeed(
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

/** PermissionedRedeemer, the map payment hash to sr25519 key, with duplicate keys kept. */
export const encodeRedeemerMap = (
  signers: readonly Signer[],
): Result.Result<PlutusData, InputParseError> =>
  signers.length > 255
    ? signersIssue("too many signers for simple CBOR encoding")
    : Result.succeed(
        PlutusData.fromCbor(
          writeSignerMap(
            new CborWriter(),
            signers,
            (s) => s.paymentHash,
          ).encodeAsHex(),
        ),
      );

// terms and conditions

/** The terms: hash and link, both hex. */
export interface TermsData {
  readonly hash: string;
  readonly link: string;
}

/** The terms of a VersionedTermsAndConditions [[hash, link], logic_round]. */
export const decodeTerms = (datum: PlutusData) =>
  decodeDatum(datum, "VersionedTermsAndConditions", (d): TermsData => {
    const [[hash, link]] = parse(Contracts.VersionedTermsAndConditions, d);
    return { hash, link };
  });

/** The VersionedTermsAndConditions of the terms at a logic_round. */
export const encodeTerms = ({ hash, link }: TermsData, round: number) =>
  serialize(Contracts.VersionedTermsAndConditions, [
    [hash, link],
    BigInt(round),
  ]);

// federated ops

/** The 4-character candidate key ids, as hex. */
const KEY_IDS = {
  aura: toHex(new TextEncoder().encode("aura")),
  gran: toHex(new TextEncoder().encode("gran")),
  beef: toHex(new TextEncoder().encode("beef")),
  babe: toHex(new TextEncoder().encode("babe")),
} as const;

/** A FederatedOps datum: v1 without a message, v2 with one. */
export interface FederatedOpsData {
  /** The "data" field (Unit in practice). */
  readonly data: PlutusData;
  /** v2 only: the message bytes as hex. */
  readonly message?: string;
  readonly candidates: readonly PermissionedCandidate[];
}

const bytesField = (
  datum: PlutusData,
  field: string,
): Result.Result<string, string> => {
  const bytes = datum.asBoundedBytes();
  return bytes === undefined
    ? Result.fail(`${field} is not a bytes value`)
    : Result.succeed(toHex(bytes));
};

/** One PermissionedCandidateDatumV1 [sidechainPubKey, [[id, bytes], ...]]. */
const decodeCandidate = (
  item: PlutusData,
): Result.Result<PermissionedCandidate, string> =>
  Result.gen(function* () {
    const tuple = item.asList();
    if (tuple === undefined || tuple.getLength() !== 2) {
      return yield* Result.fail(
        "PermissionedCandidateDatumV1: expected a 2-element list",
      );
    }
    const keys = tuple.get(1).asList();
    if (keys === undefined) {
      return yield* Result.fail("invalid CandidateKey list");
    }
    const candidate = {
      sidechain_pub_key: yield* bytesField(tuple.get(0), "sidechainPubKey"),
      aura_pub_key: "",
      grandpa_pub_key: "",
      beefy_pub_key: "",
      babe_pub_key: undefined as string | undefined,
    };
    for (let i = 0; i < keys.getLength(); i++) {
      const key = keys.get(i).asList();
      if (key === undefined || key.getLength() !== 2) {
        return yield* Result.fail("CandidateKey: expected a 2-element list");
      }
      const id = yield* bytesField(key.get(0), "candidateKey.id");
      const value = yield* bytesField(key.get(1), "candidateKey.value");
      if (id === KEY_IDS.aura) candidate.aura_pub_key = value;
      else if (id === KEY_IDS.gran) candidate.grandpa_pub_key = value;
      else if (id === KEY_IDS.beef) candidate.beefy_pub_key = value;
      else if (id === KEY_IDS.babe) candidate.babe_pub_key = value;
      else return yield* Result.fail(`CandidateKey: unknown key id ${id}`);
    }
    const { babe_pub_key, ...required } = candidate;
    return babe_pub_key === undefined
      ? required
      : { ...required, babe_pub_key };
  });

const decodeCandidates = (
  appendix: PlutusData,
): Result.Result<PermissionedCandidate[], string> => {
  const list = appendix.asList();
  if (list === undefined) return Result.fail("appendix: expected a list");
  return Result.all(
    Array.from({ length: list.getLength() }, (_, i) =>
      decodeCandidate(list.get(i)),
    ),
  );
};

/** A FederatedOps datum by its shape: v1 [data, appendix, 1] or v2 [data, message, appendix, 2]. */
export const decodeFederatedOps = (
  datum: PlutusData,
): Result.Result<FederatedOpsData, DatumParseError> => {
  const error = (what: string) => (reason: string) =>
    new DatumParseError({ what, cbor: datum.toCbor(), reason });
  const list = datum.asList();
  switch (list?.getLength()) {
    case 3:
      return Result.mapBoth(decodeCandidates(list.get(1)), {
        onFailure: error("FederatedOps v1"),
        onSuccess: (candidates) => ({ data: list.get(0), candidates }),
      });
    case 4:
      return Result.mapBoth(
        Result.all([
          bytesField(list.get(1), "message"),
          decodeCandidates(list.get(2)),
        ]),
        {
          onFailure: error("FederatedOps v2"),
          onSuccess: ([message, candidates]) => ({
            data: list.get(0),
            message,
            candidates,
          }),
        },
      );
    default:
      return Result.fail(
        error("FederatedOps")("expected a list of 3 (v1) or 4 (v2) elements"),
      );
  }
};

/** A candidate as PermissionedCandidateDatumV1 [sidechainPubKey, [[id, bytes], ...]]; babe last, when present. */
export const candidateToPermissionedDatum = (
  candidate: PermissionedCandidate,
): Contracts.PermissionedCandidateDatumV1 => [
  candidate.sidechain_pub_key,
  [
    [KEY_IDS.aura, candidate.aura_pub_key],
    [KEY_IDS.gran, candidate.grandpa_pub_key],
    [KEY_IDS.beef, candidate.beefy_pub_key],
    ...(candidate.babe_pub_key
      ? [[KEY_IDS.babe, candidate.babe_pub_key] as Contracts.CandidateKey]
      : []),
  ],
];

/** The FederatedOps datum of the data's shape: v1 at logic_round 1, v2 (with a message) at 2. */
export const encodeFederatedOps = ({
  data,
  message,
  candidates,
}: FederatedOpsData): PlutusData =>
  message === undefined
    ? serialize(Contracts.FederatedOps, [
        data,
        candidates.map(candidateToPermissionedDatum),
        1n,
      ])
    : serialize(Contracts.FederatedOpsV2, [
        data,
        message,
        candidates.map(candidateToPermissionedDatum),
        2n,
      ]);

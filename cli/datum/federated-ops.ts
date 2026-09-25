/**
 * Permissioned candidates and the FederatedOps datums: the relaxed bracket
 * format of PERMISSIONED_CANDIDATES, and the v1/v2 datum codecs.
 */
import { PlutusData, toHex } from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Either } from "effect";
import { DatumParseError, InputParseError } from "../errors";
import * as Contracts from "../../contract_blueprint";

// 4-character key identifiers as hex
const KEY_IDS = {
  aura: toHex(new TextEncoder().encode("aura")), // 61757261
  gran: toHex(new TextEncoder().encode("gran")), // 6772616e
  beef: toHex(new TextEncoder().encode("beef")), // 62656566
  babe: toHex(new TextEncoder().encode("babe")), // 62616265
} as const;

type Decoded<A> = Either.Either<A, string>;

const bytesField = (datum: PlutusData, fieldName: string): Decoded<string> => {
  const bytes = datum.asBoundedBytes();
  return bytes === undefined
    ? Either.left(`${fieldName} is not a bytes value`)
    : Either.right(Buffer.from(bytes).toString("hex"));
};

/** One PermissionedCandidateDatumV1: [sidechainPubKey, [[id, bytes], ...]]. */
const decodeCandidate = (item: PlutusData): Decoded<PermissionedCandidate> =>
  Either.gen(function* () {
    const tuple = item.asList();
    if (!tuple || tuple.getLength() !== 2) {
      return yield* Either.left(
        "PermissionedCandidateDatumV1: expected a 2-element list",
      );
    }
    const sidechain_pub_key = yield* bytesField(
      tuple.get(0),
      "sidechainPubKey",
    );
    const keysList = tuple.get(1).asList();
    if (!keysList) return yield* Either.left("invalid CandidateKey list");
    const candidate: PermissionedCandidate = {
      sidechain_pub_key,
      aura_pub_key: "",
      grandpa_pub_key: "",
      beefy_pub_key: "",
    };
    for (let i = 0; i < keysList.getLength(); i++) {
      const keyTuple = keysList.get(i).asList();
      if (!keyTuple || keyTuple.getLength() !== 2) {
        return yield* Either.left("CandidateKey: expected a 2-element list");
      }
      const id = yield* bytesField(keyTuple.get(0), "candidateKey.id");
      const value = yield* bytesField(keyTuple.get(1), "candidateKey.value");
      if (id === KEY_IDS.aura) candidate.aura_pub_key = value;
      else if (id === KEY_IDS.gran) candidate.grandpa_pub_key = value;
      else if (id === KEY_IDS.beef) candidate.beefy_pub_key = value;
      else if (id === KEY_IDS.babe) candidate.babe_pub_key = value;
      else {
        return yield* Either.left(`CandidateKey: unknown key id ${id}`);
      }
    }
    return candidate;
  });

const decodeCandidates = (
  appendix: PlutusData,
): Decoded<PermissionedCandidate[]> => {
  const list = appendix.asList();
  if (!list) return Either.left("appendix: expected a list");
  const items = [];
  for (let i = 0; i < list.getLength(); i++)
    items.push(decodeCandidate(list.get(i)));
  return Either.all(items);
};

const parseError = (cbor: PlutusData, what: string) => (reason: string) =>
  new DatumParseError({ what, cbor: cbor.toCbor(), reason });

/** A FederatedOps datum: v1 without a message, v2 with one. */
export interface FederatedOpsData {
  /** The "data" field (Unit in practice). */
  readonly data: PlutusData;
  /** v2 only: the message bytes as hex. */
  readonly message?: string;
  readonly candidates: readonly PermissionedCandidate[];
}

/** A FederatedOps datum by its shape: v1 [data, appendix, 1] or v2 [data, message, appendix, 2]. */
export const decodeFederatedOps = (
  cbor: PlutusData,
): Either.Either<FederatedOpsData, DatumParseError> => {
  const list = cbor.asList();
  switch (list?.getLength()) {
    case 3:
      return Either.mapBoth(decodeCandidates(list.get(1)), {
        onLeft: parseError(cbor, "FederatedOps v1"),
        onRight: (candidates) => ({ data: list.get(0), candidates }),
      });
    case 4:
      return Either.mapBoth(
        Either.all([
          bytesField(list.get(1), "message"),
          decodeCandidates(list.get(2)),
        ]),
        {
          onLeft: parseError(cbor, "FederatedOps v2"),
          onRight: ([message, candidates]) => ({
            data: list.get(0),
            message,
            candidates,
          }),
        },
      );
    default:
      return Either.left(
        parseError(
          cbor,
          "FederatedOps",
        )("expected a list of 3 (v1) or 4 (v2) elements"),
      );
  }
};

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

const SOURCE = "PERMISSIONED_CANDIDATES";

const issue = (...issues: string[]) =>
  Either.left(new InputParseError({ source: SOURCE, issues }));

export interface PermissionedCandidate {
  sidechain_pub_key: string;
  aura_pub_key: string;
  grandpa_pub_key: string;
  beefy_pub_key: string;
  babe_pub_key?: string;
}

/** Parse `[ { sidechain_pub_key:..., aura_pub_key:..., grandpa_pub_key:..., beefy_pub_key:... }, ... ]` (babe_pub_key optional). */
export const parseCandidates = (
  input: string,
): Either.Either<PermissionedCandidate[], InputParseError> => {
  const trimmed = input.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return issue("expected input to be wrapped in [ ]");
  }
  const content = trimmed.slice(1, -1).trim();
  return Either.flatMap(splitCandidateBlocks(content), (blocks) =>
    content.length > 0 && blocks.length === 0
      ? issue(
          "non-empty input yielded zero candidate blocks; check for malformed braces",
        )
      : Either.all(
          blocks.map((block, index) => parseCandidateBlock(block, index)),
        ),
  );
};

/** Split `{ ... }, { ... }` into the inner text of each block. */
const splitCandidateBlocks = (
  content: string,
): Either.Either<string[], InputParseError> => {
  const blocks: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of content) {
    if (char === "{") {
      depth++;
      if (depth === 1) {
        current = "";
        continue;
      }
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        blocks.push(current.trim());
        current = "";
        continue;
      }
    }
    if (depth > 0) current += char;
  }
  return depth !== 0
    ? issue(`unbalanced braces (depth=${depth})`)
    : Either.right(blocks.filter((b) => b.length > 0));
};

const REQUIRED_FIELDS = [
  "sidechain_pub_key",
  "aura_pub_key",
  "grandpa_pub_key",
  "beefy_pub_key",
] as const;

const HEX = /^[0-9a-fA-F]+$/;

/** Parse one `key:value` block into a candidate; every key must be hex. */
const parseCandidateBlock = (
  block: string,
  index: number,
): Either.Either<PermissionedCandidate, InputParseError> => {
  const fields: Record<string, string> = {};
  for (const line of block.split(/[,\n]/)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) {
      return issue(
        `candidate at index ${index} has an entry without ':': ${line.trim()}`,
      );
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key && value) fields[key] = value;
  }
  for (const field of REQUIRED_FIELDS) {
    const value = fields[field];
    if (!value)
      return issue(
        `candidate at index ${index} is missing required field: ${field}`,
      );
    if (!HEX.test(value)) {
      return issue(
        `candidate at index ${index} has invalid hex value for ${field}: ${value}`,
      );
    }
  }
  const babe = fields.babe_pub_key;
  if (babe && !HEX.test(babe)) {
    return issue(
      `candidate at index ${index} has invalid hex value for babe_pub_key: ${babe}`,
    );
  }
  const candidate: PermissionedCandidate = {
    sidechain_pub_key: fields.sidechain_pub_key,
    aura_pub_key: fields.aura_pub_key,
    grandpa_pub_key: fields.grandpa_pub_key,
    beefy_pub_key: fields.beefy_pub_key,
  };
  return Either.right(babe ? { ...candidate, babe_pub_key: babe } : candidate);
};

/** A candidate as PermissionedCandidateDatumV1 = [sidechainPubKey, [[id, bytes], ...]]. */
export function candidateToPermissionedDatum(
  candidate: PermissionedCandidate,
): Contracts.PermissionedCandidateDatumV1 {
  const candidateKeys: Contracts.CandidateKey[] = [
    [KEY_IDS.aura, candidate.aura_pub_key],
    [KEY_IDS.gran, candidate.grandpa_pub_key],
    [KEY_IDS.beef, candidate.beefy_pub_key],
  ];
  if (candidate.babe_pub_key) {
    candidateKeys.push([KEY_IDS.babe, candidate.babe_pub_key]);
  }

  return [candidate.sidechain_pub_key, candidateKeys];
}

/** The FederatedOps datum a deployment creates: [Unit, the candidates' appendix, logic round 1]. */
export const initialFederatedOpsDatum = (
  candidates: readonly PermissionedCandidate[],
): PlutusData =>
  encodeFederatedOps({
    data: PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
    candidates,
  });

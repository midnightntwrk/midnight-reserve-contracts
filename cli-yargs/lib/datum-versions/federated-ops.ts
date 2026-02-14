import { PlutusData, PlutusList, toHex } from "@blaze-cardano/core";
import type { DatumVersionHandler, FederatedOpsData } from "./types";
import type { PermissionedCandidate } from "../candidates";

function expectBytes(datum: PlutusData, fieldName: string): string {
  const bytes = datum.asBoundedBytes();
  if (bytes === undefined || bytes === null) {
    throw new Error(`Invalid datum: ${fieldName} is not a bytes value`);
  }
  return Buffer.from(bytes).toString("hex");
}

// 4-character key identifiers as hex
const KEY_IDS = {
  aura: toHex(new TextEncoder().encode("aura")), // 61757261
  gran: toHex(new TextEncoder().encode("gran")), // 6772616e
  beef: toHex(new TextEncoder().encode("beef")), // 62656566
} as const;

/**
 * Decode a single PermissionedCandidateDatumV1 from PlutusData.
 *
 * Shape: [sidechainPubKey (bytes), candidateKeys (list of [id, bytes])]
 */
function decodeCandidateFromPlutus(item: PlutusData): PermissionedCandidate {
  const tuple = item.asList();
  if (!tuple || tuple.getLength() < 2) {
    throw new Error(
      "Invalid PermissionedCandidateDatumV1: expected 2-element list",
    );
  }

  const sidechainPubKey = expectBytes(tuple.get(0), "sidechainPubKey");
  const keysList = tuple.get(1).asList();
  if (!keysList) {
    throw new Error("Invalid CandidateKey list");
  }

  const candidate: PermissionedCandidate = {
    sidechain_pub_key: sidechainPubKey,
    aura_pub_key: "",
    grandpa_pub_key: "",
    beefy_pub_key: "",
  };

  for (let i = 0; i < keysList.getLength(); i++) {
    const keyTuple = keysList.get(i).asList();
    if (!keyTuple || keyTuple.getLength() < 2) continue;

    const id = expectBytes(keyTuple.get(0), "candidateKey.id");
    const value = expectBytes(keyTuple.get(1), "candidateKey.value");

    if (id === KEY_IDS.aura) candidate.aura_pub_key = value;
    else if (id === KEY_IDS.gran) candidate.grandpa_pub_key = value;
    else if (id === KEY_IDS.beef) candidate.beefy_pub_key = value;
  }

  return candidate;
}

/**
 * Decode a list of PermissionedCandidateDatumV1 from PlutusData.
 */
function decodeCandidatesFromPlutus(
  appendix: PlutusData,
): PermissionedCandidate[] {
  const list = appendix.asList();
  if (!list) {
    throw new Error("Invalid appendix: expected list");
  }

  const candidates: PermissionedCandidate[] = [];
  for (let i = 0; i < list.getLength(); i++) {
    candidates.push(decodeCandidateFromPlutus(list.get(i)));
  }
  return candidates;
}

/**
 * Encode a PermissionedCandidate to PlutusData.
 */
function encodeCandidateToPlutus(candidate: PermissionedCandidate): PlutusData {
  const keysList = new PlutusList();

  // aura key
  const auraTuple = new PlutusList();
  auraTuple.add(PlutusData.newBytes(Buffer.from(KEY_IDS.aura, "hex")));
  auraTuple.add(
    PlutusData.newBytes(Buffer.from(candidate.aura_pub_key, "hex")),
  );
  keysList.add(PlutusData.newList(auraTuple));

  // gran key
  const granTuple = new PlutusList();
  granTuple.add(PlutusData.newBytes(Buffer.from(KEY_IDS.gran, "hex")));
  granTuple.add(
    PlutusData.newBytes(Buffer.from(candidate.grandpa_pub_key, "hex")),
  );
  keysList.add(PlutusData.newList(granTuple));

  // beef key
  const beefTuple = new PlutusList();
  beefTuple.add(PlutusData.newBytes(Buffer.from(KEY_IDS.beef, "hex")));
  beefTuple.add(
    PlutusData.newBytes(Buffer.from(candidate.beefy_pub_key, "hex")),
  );
  keysList.add(PlutusData.newList(beefTuple));

  const datumList = new PlutusList();
  datumList.add(
    PlutusData.newBytes(Buffer.from(candidate.sidechain_pub_key, "hex")),
  );
  datumList.add(PlutusData.newList(keysList));
  return PlutusData.newList(datumList);
}

/**
 * Encode a list of PermissionedCandidate to PlutusData.
 */
function encodeCandidatesToPlutus(
  candidates: PermissionedCandidate[],
): PlutusData {
  const list = new PlutusList();
  for (const c of candidates) {
    list.add(encodeCandidateToPlutus(c));
  }
  return PlutusData.newList(list);
}

/**
 * FederatedOps handler for logic_round 1 (v1).
 *
 * Datum shape: [data (Unit constr), appendix (List<PermissionedCandidateDatumV1>), logic_round]
 */
function getCandidates(data: FederatedOpsData): PermissionedCandidate[] {
  return data.candidates;
}

function setCandidates(
  data: FederatedOpsData,
  candidates: PermissionedCandidate[],
): FederatedOpsData {
  return { ...data, candidates };
}

export const federatedOpsRound1: DatumVersionHandler<FederatedOpsData> = {
  logicRound: 1,

  decode(cbor: PlutusData): FederatedOpsData {
    const list = cbor.asList();
    if (!list || list.getLength() < 3) {
      throw new Error(
        "Invalid FederatedOps v1: expected list with at least 3 elements",
      );
    }

    const data = list.get(0);
    const appendixRaw = list.get(1);
    const candidates = decodeCandidatesFromPlutus(appendixRaw);

    return { data, candidates, appendixRaw };
  },

  encode(datum: FederatedOpsData): PlutusData {
    const list = new PlutusList();
    list.add(datum.data);
    list.add(encodeCandidatesToPlutus(datum.candidates));
    list.add(PlutusData.newInteger(1n));
    return PlutusData.newList(list);
  },

  getCandidates,
  setCandidates,
};

/**
 * FederatedOps handler for logic_round 2 (v2, adds message field).
 *
 * Datum shape: [data (Unit constr), message (bytes), appendix (List<PermissionedCandidateDatumV1>), logic_round]
 */
export const federatedOpsRound2: DatumVersionHandler<FederatedOpsData> = {
  logicRound: 2,

  decode(cbor: PlutusData): FederatedOpsData {
    const list = cbor.asList();
    if (!list || list.getLength() < 4) {
      throw new Error(
        "Invalid FederatedOps v2: expected list with at least 4 elements",
      );
    }

    const data = list.get(0);
    const message = expectBytes(list.get(1), "message");
    const appendixRaw = list.get(2);
    const candidates = decodeCandidatesFromPlutus(appendixRaw);

    return { data, message, candidates, appendixRaw };
  },

  encode(datum: FederatedOpsData): PlutusData {
    const list = new PlutusList();
    list.add(datum.data);
    list.add(PlutusData.newBytes(Buffer.from(datum.message ?? "", "hex")));
    list.add(encodeCandidatesToPlutus(datum.candidates));
    list.add(PlutusData.newInteger(2n));
    return PlutusData.newList(list);
  },

  getCandidates,
  setCandidates,
};

/** All federated-ops handlers indexed by logic_round. */
export const federatedOpsHandlers: Record<
  number,
  DatumVersionHandler<FederatedOpsData>
> = {
  1: federatedOpsRound1,
  2: federatedOpsRound2,
};

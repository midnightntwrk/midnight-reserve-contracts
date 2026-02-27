import { PlutusData, PlutusList } from "@blaze-cardano/core";
import type { DatumVersionHandler, TermsData } from "./types";

function expectBytes(datum: PlutusData, fieldName: string): string {
  const bytes = datum.asBoundedBytes();
  if (bytes === undefined || bytes === null) {
    throw new Error(
      `Invalid TermsAndConditions: ${fieldName} is not a bytes value`,
    );
  }
  return Buffer.from(bytes).toString("hex");
}

/**
 * Terms & Conditions handler for logic_round 0.
 *
 * Datum shape: VersionedTermsAndConditions = [[hash, link], logic_round]
 * where TermsAndConditions = [hash (bytes), link (bytes)]
 */
function getTerms(data: TermsData): TermsData {
  return data;
}

function setTerms(_data: TermsData, terms: TermsData): TermsData {
  return terms;
}

export const termsRound0: DatumVersionHandler<TermsData> = {
  logicRound: 0,

  decode(cbor: PlutusData): TermsData {
    const outerList = cbor.asList();
    if (!outerList || outerList.getLength() < 2) {
      throw new Error(
        "Invalid VersionedTermsAndConditions: expected list with at least 2 elements",
      );
    }

    const tcTuple = outerList.get(0).asList();
    if (!tcTuple || tcTuple.getLength() < 2) {
      throw new Error(
        "Invalid TermsAndConditions tuple: expected list with at least 2 elements",
      );
    }

    const hash = expectBytes(tcTuple.get(0), "hash");
    const link = expectBytes(tcTuple.get(1), "link");

    return { hash, link };
  },

  encode(datum: TermsData): PlutusData {
    const tcTuple = new PlutusList();
    tcTuple.add(PlutusData.newBytes(Buffer.from(datum.hash, "hex")));
    tcTuple.add(PlutusData.newBytes(Buffer.from(datum.link, "hex")));

    const outerList = new PlutusList();
    outerList.add(PlutusData.newList(tcTuple));
    outerList.add(PlutusData.newInteger(BigInt(termsRound0.logicRound)));

    return PlutusData.newList(outerList);
  },

  getTerms,
  setTerms,
};

/**
 * Terms & Conditions handler for logic_round 1 (v2 logic).
 *
 * Same datum shape as round 0 — only the logic_round field changes.
 */
export const termsRound1: DatumVersionHandler<TermsData> = {
  logicRound: 1,

  decode(cbor: PlutusData): TermsData {
    const outerList = cbor.asList();
    if (!outerList || outerList.getLength() < 2) {
      throw new Error(
        "Invalid VersionedTermsAndConditions: expected list with at least 2 elements",
      );
    }

    const tcTuple = outerList.get(0).asList();
    if (!tcTuple || tcTuple.getLength() < 2) {
      throw new Error(
        "Invalid TermsAndConditions tuple: expected list with at least 2 elements",
      );
    }

    const hash = expectBytes(tcTuple.get(0), "hash");
    const link = expectBytes(tcTuple.get(1), "link");

    return { hash, link };
  },

  encode(datum: TermsData): PlutusData {
    const tcTuple = new PlutusList();
    tcTuple.add(PlutusData.newBytes(Buffer.from(datum.hash, "hex")));
    tcTuple.add(PlutusData.newBytes(Buffer.from(datum.link, "hex")));

    const outerList = new PlutusList();
    outerList.add(PlutusData.newList(tcTuple));
    outerList.add(PlutusData.newInteger(BigInt(termsRound1.logicRound)));

    return PlutusData.newList(outerList);
  },

  getTerms,
  setTerms,
};

/** All terms-and-conditions handlers indexed by logic_round. */
export const termsHandlers: Record<number, DatumVersionHandler<TermsData>> = {
  0: termsRound0,
  1: termsRound1,
};

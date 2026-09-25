/** VersionedTermsAndConditions [[hash, link], logic_round] through the blueprint schema. */
import type { PlutusData } from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import * as Contracts from "../../contract_blueprint";
import { decodeDatum } from "../chain/transaction";

/** The terms: hash and link, both hex. */
export interface TermsData {
  readonly hash: string;
  readonly link: string;
}

/** The terms of a VersionedTermsAndConditions datum. */
export const decodeTerms = (datum: PlutusData) =>
  decodeDatum(datum, "VersionedTermsAndConditions", (d): TermsData => {
    const [[hash, link]] = parse(Contracts.VersionedTermsAndConditions, d);
    return { hash, link };
  });

/** The VersionedTermsAndConditions datum of the terms at a logic_round. */
export const encodeTerms = ({ hash, link }: TermsData, round: number) =>
  serialize(Contracts.VersionedTermsAndConditions, [
    [hash, link],
    BigInt(round),
  ]);

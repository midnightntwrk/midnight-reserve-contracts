import { describe, test, expect } from "bun:test";
import { HexBlob, PlutusData, PlutusList } from "@blaze-cardano/core";
import {
  createMultisigStateCbor,
  extractSignersFromCbor,
} from "../cli-yargs/lib/signers";
import {
  getDatumHandler,
  extractLogicRound,
  councilRound0,
  termsRound0,
  federatedOpsRound1,
  federatedOpsRound2,
} from "../cli-yargs/lib/datum-versions";
import type {
  MultisigData,
  FederatedOpsData,
  TermsData,
} from "../cli-yargs/lib/datum-versions";
import type { Signer } from "../cli-yargs/lib/types";

describe("datum-versions", () => {
  describe("Multisig CBOR round-trip with duplicate keys", () => {
    const singlePaymentHash =
      "f932cb4c0de84606b3da87214324887270f5fb0e04a6870dc7df5f23";
    const duplicateSigners: Signer[] = [
      {
        paymentHash: singlePaymentHash,
        sr25519Key:
          "de2306334193be59122367e5a774769e59de84baacfd8e136fba8e18dbcd0833",
      },
      {
        paymentHash: singlePaymentHash,
        sr25519Key:
          "8c457a4b2383443ff5b30420aea92bfca65971fd0b76d21715529e4e8192be1d",
      },
      {
        paymentHash: singlePaymentHash,
        sr25519Key:
          "f6aa16d4c6892575af371fd14e1e40a7c4675876e8f331e2e2466a28e950765f",
      },
    ];

    test("decode then encode produces byte-equal CBOR for duplicate-key datum", () => {
      const original = createMultisigStateCbor(duplicateSigners, 0n);
      const originalCbor = original.toCbor();

      const handler = getDatumHandler("council", 0);
      const decoded = handler.decode(original);
      const reencoded = handler.encode(decoded);
      const reencodedCbor = reencoded.toCbor();

      expect(reencodedCbor).toBe(originalCbor);
    });

    test("preserves totalSigners even when it differs from array length", () => {
      // Create a datum with totalSigners=5 but only 3 actual signers
      const datumWithMismatch = createMultisigStateCbor(
        duplicateSigners,
        0n,
        5n,
      );
      const originalCbor = datumWithMismatch.toCbor();

      const handler = getDatumHandler("council", 0);
      const decoded = handler.decode(datumWithMismatch);

      expect(decoded.totalSigners).toBe(5n);
      expect(decoded.signers).toHaveLength(3);

      const reencoded = handler.encode(decoded);
      expect(reencoded.toCbor()).toBe(originalCbor);
    });

    test("preserves all duplicate signers through decode/encode cycle", () => {
      const original = createMultisigStateCbor(duplicateSigners, 0n);

      const handler = getDatumHandler("council", 0);
      const decoded = handler.decode(original);

      expect(decoded.signers).toHaveLength(3);
      // All 3 have the same paymentHash
      for (const signer of decoded.signers) {
        expect(signer.paymentHash).toBe(singlePaymentHash);
      }
      // But different sr25519 keys
      const keys = new Set(decoded.signers.map((s) => s.sr25519Key));
      expect(keys.size).toBe(3);
    });

    test("round-trip works for tech-auth with same duplicate-key pattern", () => {
      const original = createMultisigStateCbor(duplicateSigners, 1n);
      const originalCbor = original.toCbor();

      const handler = getDatumHandler("tech-auth", 1);
      const decoded = handler.decode(original);
      const reencoded = handler.encode(decoded);

      expect(reencoded.toCbor()).toBe(originalCbor);
    });
  });

  describe("Multisig accessor methods", () => {
    const signers: Signer[] = [
      {
        paymentHash: "3958ae4a79fa36f52c9e0f5fab7aac2d4c4446a290b44e2d2f53d387",
        sr25519Key:
          "d2a9e63d7a883dfe271d2ca91c06917fdb459126162c77ff83b480d6415a551f",
      },
      {
        paymentHash: "c6f2de5adbbf0b77adcc6883d562a4f5a535017eaedc6804c5e55b33",
        sr25519Key:
          "9e6619809817313de02029b0b9232ccc880d8ee37e2fed8cabc73694045fee29",
      },
    ];

    test("getMemberList returns payment hashes", () => {
      const datum = createMultisigStateCbor(signers, 0n);
      const handler = getDatumHandler("council", 0);
      const decoded = handler.decode(datum);

      const members = handler.getMemberList!(decoded);
      expect(members).toEqual([signers[0].paymentHash, signers[1].paymentHash]);
    });
  });

  describe("getDatumHandler error cases", () => {
    test("falls back to highest round for council round > max", () => {
      // Round 99 > max(0,1) → falls back to round 1 handler
      const handler = getDatumHandler("council", 99);
      expect(handler.logicRound).toBe(1);
    });

    test("throws on unknown logic_round for federated-ops round < min", () => {
      expect(() => getDatumHandler("federated-ops", 0)).toThrow(
        "Unsupported logic_round 0",
      );
    });

    test("falls back to highest round for terms-and-conditions round > max", () => {
      // Round 5 > max(0,1) → falls back to round 1 handler
      const handler = getDatumHandler("terms-and-conditions", 5);
      expect(handler.logicRound).toBe(1);
    });

    test("returns correct handler for valid rounds", () => {
      expect(getDatumHandler("council", 0).logicRound).toBe(0);
      expect(getDatumHandler("council", 1).logicRound).toBe(1);
      expect(getDatumHandler("tech-auth", 0).logicRound).toBe(0);
      expect(getDatumHandler("tech-auth", 1).logicRound).toBe(1);
      expect(getDatumHandler("federated-ops", 1).logicRound).toBe(1);
      expect(getDatumHandler("federated-ops", 2).logicRound).toBe(2);
      expect(getDatumHandler("terms-and-conditions", 0).logicRound).toBe(0);
      expect(getDatumHandler("terms-and-conditions", 1).logicRound).toBe(1);
    });
  });

  describe("extractLogicRound", () => {
    test("extracts logic_round from VersionedMultisig CBOR", () => {
      const signers: Signer[] = [
        {
          paymentHash:
            "3958ae4a79fa36f52c9e0f5fab7aac2d4c4446a290b44e2d2f53d387",
          sr25519Key:
            "d2a9e63d7a883dfe271d2ca91c06917fdb459126162c77ff83b480d6415a551f",
        },
      ];

      const round0 = createMultisigStateCbor(signers, 0n);
      expect(extractLogicRound(round0)).toBe(0);

      const round1 = createMultisigStateCbor(signers, 1n);
      expect(extractLogicRound(round1)).toBe(1);
    });

    test("extracts logic_round from VersionedTermsAndConditions", () => {
      const terms: TermsData = { hash: "aabb", link: "ccdd" };
      const encoded = termsRound0.encode(terms);
      expect(extractLogicRound(encoded)).toBe(0);
    });

    test("throws on non-list datum", () => {
      const intDatum = PlutusData.newInteger(42n);
      expect(() => extractLogicRound(intDatum)).toThrow(
        "datum is not a list with >= 2 elements",
      );
    });

    test("throws on single-element list", () => {
      const shortList = new PlutusList();
      shortList.add(PlutusData.newInteger(0n));
      const datum = PlutusData.newList(shortList);
      expect(() => extractLogicRound(datum)).toThrow(
        "datum is not a list with >= 2 elements",
      );
    });

    test("throws when last element is not an integer", () => {
      const badList = new PlutusList();
      badList.add(PlutusData.newInteger(0n));
      badList.add(PlutusData.newBytes(new Uint8Array([1, 2, 3])));
      const datum = PlutusData.newList(badList);
      expect(() => extractLogicRound(datum)).toThrow(
        "last element is not an integer",
      );
    });
  });

  describe("Terms round-trip", () => {
    test("decode then encode produces structurally equivalent datum", () => {
      const terms: TermsData = {
        hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        link: "68747470733a2f2f6578616d706c652e636f6d",
      };

      const handler = getDatumHandler("terms-and-conditions", 0);
      const encoded = handler.encode(terms);
      const decoded = handler.decode(encoded);

      expect(decoded.hash).toBe(terms.hash);
      expect(decoded.link).toBe(terms.link);
    });

    test("getTerms returns the data", () => {
      const terms: TermsData = { hash: "aa", link: "bb" };
      const handler = getDatumHandler("terms-and-conditions", 0);
      const result = handler.getTerms!(terms);
      expect(result).toEqual(terms);
    });

    test("setTerms replaces the data", () => {
      const original: TermsData = { hash: "aa", link: "bb" };
      const replacement: TermsData = { hash: "cc", link: "dd" };
      const handler = getDatumHandler("terms-and-conditions", 0);
      const result = handler.setTerms!(original, replacement);
      expect(result).toEqual(replacement);
    });
  });

  describe("FederatedOps round-trip", () => {
    test("v1 decode then encode round-trips", () => {
      const unitDatum = PlutusData.fromCore({
        constructor: 0n,
        fields: { items: [] },
      });

      // Build a v1 datum: [Unit, appendix, 1]
      const candidateKeys = new PlutusList();
      const auraTuple = new PlutusList();
      auraTuple.add(PlutusData.newBytes(Buffer.from("61757261", "hex")));
      auraTuple.add(PlutusData.newBytes(Buffer.from("aabb", "hex")));
      candidateKeys.add(PlutusData.newList(auraTuple));

      const granTuple = new PlutusList();
      granTuple.add(PlutusData.newBytes(Buffer.from("6772616e", "hex")));
      granTuple.add(PlutusData.newBytes(Buffer.from("ccdd", "hex")));
      candidateKeys.add(PlutusData.newList(granTuple));

      const beefTuple = new PlutusList();
      beefTuple.add(PlutusData.newBytes(Buffer.from("62656566", "hex")));
      beefTuple.add(PlutusData.newBytes(Buffer.from("eeff", "hex")));
      candidateKeys.add(PlutusData.newList(beefTuple));

      const candidateDatum = new PlutusList();
      candidateDatum.add(PlutusData.newBytes(Buffer.from("1122", "hex")));
      candidateDatum.add(PlutusData.newList(candidateKeys));

      const appendix = new PlutusList();
      appendix.add(PlutusData.newList(candidateDatum));

      const v1List = new PlutusList();
      v1List.add(unitDatum);
      v1List.add(PlutusData.newList(appendix));
      v1List.add(PlutusData.newInteger(1n));
      const v1Datum = PlutusData.newList(v1List);

      const handler = getDatumHandler("federated-ops", 1);
      const decoded = handler.decode(v1Datum);

      expect(decoded.candidates).toHaveLength(1);
      expect(decoded.candidates[0].sidechain_pub_key).toBe("1122");
      expect(decoded.candidates[0].aura_pub_key).toBe("aabb");
      expect(decoded.candidates[0].grandpa_pub_key).toBe("ccdd");
      expect(decoded.candidates[0].beefy_pub_key).toBe("eeff");
      expect(decoded.message).toBeUndefined();

      // getCandidates accessor
      const candidates = handler.getCandidates!(decoded);
      expect(candidates).toEqual(decoded.candidates);
    });

    test("v2 decode includes message field", () => {
      const unitDatum = PlutusData.fromCore({
        constructor: 0n,
        fields: { items: [] },
      });

      const appendix = new PlutusList();
      const v2List = new PlutusList();
      v2List.add(unitDatum);
      v2List.add(PlutusData.newBytes(Buffer.from("cafe", "hex")));
      v2List.add(PlutusData.newList(appendix));
      v2List.add(PlutusData.newInteger(2n));
      const v2Datum = PlutusData.newList(v2List);

      const handler = getDatumHandler("federated-ops", 2);
      const decoded = handler.decode(v2Datum);

      expect(decoded.message).toBe("cafe");
      expect(decoded.candidates).toHaveLength(0);
    });
  });
});

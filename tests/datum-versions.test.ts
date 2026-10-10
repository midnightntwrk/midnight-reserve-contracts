import { describe, test, expect } from "bun:test";
import { PlutusData, PlutusList } from "@blaze-cardano/core";
import { Either } from "effect";
import { leftOf } from "./helpers/effect";
import {
  decodeSigners,
  encodeMultisigState,
  type Signer,
} from "../cli/datum/signers";
import { logicRound } from "../cli/datum/datum-versions";
import {
  decodeTerms,
  encodeTerms,
  type TermsData,
} from "../cli/datum/terms-and-conditions";

const multisigStateOf = (
  signers: readonly Signer[],
  round: bigint,
  totalSigners?: bigint,
) => Either.getOrThrow(encodeMultisigState(signers, round, totalSigners));

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

const list = (...items: PlutusData[]) => {
  const plutusList = new PlutusList();
  for (const item of items) plutusList.add(item);
  return PlutusData.newList(plutusList);
};

const signers: [Signer, Signer] = [
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

describe("datum-versions", () => {
  describe("multisig CBOR round-trip with duplicate keys", () => {
    test.each([0n, 1n])(
      "decode then encode is byte-equal at round %d",
      (round) => {
        const original = multisigStateOf(duplicateSigners, round);
        const decoded = Either.getOrThrow(decodeSigners(original));
        expect(multisigStateOf(decoded, round).toCbor()).toBe(
          original.toCbor(),
        );
      },
    );

    test("rejects a datum that is not exactly a VersionedMultisig", () => {
      const extra = multisigStateOf(signers, 0n).asList()!;
      extra.add(PlutusData.newInteger(0n));
      for (const datum of [
        PlutusData.newInteger(1n),
        PlutusData.newList(extra),
      ]) {
        expect(leftOf(decodeSigners(datum)).reason).toContain(
          "a list of 2 elements",
        );
      }
    });
  });

  describe("logicRound", () => {
    test("extracts logic_round from VersionedMultisig CBOR", () => {
      expect(logicRound(multisigStateOf(signers, 0n))).toEqual(Either.right(0));
      expect(logicRound(multisigStateOf(signers, 1n))).toEqual(Either.right(1));
    });

    test("extracts logic_round from VersionedTermsAndConditions and round-trips it", () => {
      const terms: TermsData = { hash: "aabb", link: "ccdd" };
      const encoded = encodeTerms(terms, 0);
      expect(logicRound(encoded)).toEqual(Either.right(0));
      expect(Either.getOrThrow(decodeTerms(encoded))).toEqual(terms);
    });

    test.each([
      [
        "a non-list datum",
        PlutusData.newInteger(42n),
        "datum is not a list with >= 2 elements",
      ],
      [
        "a single-element list",
        list(PlutusData.newInteger(0n)),
        "datum is not a list with >= 2 elements",
      ],
      [
        "a last element that is not an integer",
        list(
          PlutusData.newInteger(0n),
          PlutusData.newBytes(new Uint8Array([1, 2, 3])),
        ),
        "last element is not an integer",
      ],
    ])("rejects %s", (_, datum, reason) => {
      expect(leftOf(logicRound(datum)).reason).toContain(reason);
    });
  });
});

import { describe, test, expect } from "bun:test";
import { PlutusData, PlutusList, toHex } from "@blaze-cardano/core";
import { Either } from "effect";
import {
  parseCandidates,
  candidateToPermissionedDatum,
  decodeFederatedOps,
  encodeFederatedOps,
  type PermissionedCandidate,
} from "../cli/datum/federated-ops";
import { leftOf } from "./helpers/effect";

const parsed = (input: string) => Either.getOrThrow(parseCandidates(input));

// Expected 4-char key identifiers as hex
const KEY_IDS = {
  aura: toHex(new TextEncoder().encode("aura")), // 61757261
  gran: toHex(new TextEncoder().encode("gran")), // 6772616e
  beef: toHex(new TextEncoder().encode("beef")), // 62656566
  babe: toHex(new TextEncoder().encode("babe")), // 62616265
};

const CANDIDATE_A: PermissionedCandidate = {
  sidechain_pub_key:
    "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
  aura_pub_key:
    "1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03",
  grandpa_pub_key:
    "5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5",
  beefy_pub_key:
    "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
};
const BABE = "b0521e374b0586d6829dad320753c62cdc6ef5edbd37ffdd36da0ae97c521819";

describe("Candidates Parser", () => {
  describe("parseCandidates", () => {
    test("parses a single candidate correctly", () => {
      expect(
        parsed(`[
          {
            sidechain_pub_key:${CANDIDATE_A.sidechain_pub_key},
            aura_pub_key:${CANDIDATE_A.aura_pub_key},
            grandpa_pub_key:${CANDIDATE_A.grandpa_pub_key},
            beefy_pub_key:${CANDIDATE_A.beefy_pub_key}
          }
        ]`),
      ).toEqual([CANDIDATE_A]);
    });

    test("parses multiple candidates correctly", () => {
      expect(
        parsed(`[
          {
            sidechain_pub_key:${CANDIDATE_A.sidechain_pub_key},
            aura_pub_key:${CANDIDATE_A.aura_pub_key},
            grandpa_pub_key:${CANDIDATE_A.grandpa_pub_key},
            babe_pub_key:${BABE},
            beefy_pub_key:${CANDIDATE_A.beefy_pub_key}
          },
          {
            sidechain_pub_key:0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a,
            aura_pub_key:b0521e374b0586d6829dad320753c62cdc6ef5edbd37ffdd36da0ae97c521819,
            grandpa_pub_key:3f7f2fc8829c649501a0fb72a79abf885aa89e6c4ee2d00c6041dfa85e320980,
            beefy_pub_key:0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a
          }
        ]`),
      ).toEqual([
        { ...CANDIDATE_A, babe_pub_key: BABE },
        {
          sidechain_pub_key:
            "0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a",
          aura_pub_key:
            "b0521e374b0586d6829dad320753c62cdc6ef5edbd37ffdd36da0ae97c521819",
          grandpa_pub_key:
            "3f7f2fc8829c649501a0fb72a79abf885aa89e6c4ee2d00c6041dfa85e320980",
          beefy_pub_key:
            "0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a",
        },
      ]);
    });

    test("handles the compact format", () => {
      expect(
        parsed(
          "[{sidechain_pub_key:aabb,aura_pub_key:ccdd,grandpa_pub_key:eeff,beefy_pub_key:1122}]",
        ),
      ).toEqual([
        {
          sidechain_pub_key: "aabb",
          aura_pub_key: "ccdd",
          grandpa_pub_key: "eeff",
          beefy_pub_key: "1122",
        },
      ]);
    });

    test.each([
      [
        "input not wrapped in brackets",
        "{sidechain_pub_key:abc}",
        "expected input to be wrapped in [ ]",
      ],
      [
        "a missing required field",
        `[{sidechain_pub_key:${CANDIDATE_A.sidechain_pub_key},aura_pub_key:${CANDIDATE_A.aura_pub_key}}]`,
        "missing required field",
      ],
      [
        "an invalid hex value",
        `[{sidechain_pub_key:invalidhex!!!,aura_pub_key:aa,grandpa_pub_key:bb,beefy_pub_key:cc}]`,
        "invalid hex value",
      ],
      [
        "an entry without ':'",
        "[{sidechain_pub_key:aabb,aura_pub_key ccdd,grandpa_pub_key:eeff,beefy_pub_key:1122}]",
        "has an entry without ':': aura_pub_key ccdd",
      ],
    ])("rejects %s", (_name, input, issue) => {
      const error = leftOf(parseCandidates(input));
      expect(error.source).toBe("PERMISSIONED_CANDIDATES");
      expect(error.issues.join("\n")).toContain(issue);
    });
  });

  describe("candidateToPermissionedDatum", () => {
    test("converts candidate to PermissionedCandidateDatumV1 format", () => {
      expect(candidateToPermissionedDatum(CANDIDATE_A)).toEqual([
        CANDIDATE_A.sidechain_pub_key,
        [
          [KEY_IDS.aura, CANDIDATE_A.aura_pub_key],
          [KEY_IDS.gran, CANDIDATE_A.grandpa_pub_key],
          [KEY_IDS.beef, CANDIDATE_A.beefy_pub_key],
        ],
      ]);
    });

    test("appends babe_pub_key as an extra key when present", () => {
      expect(
        candidateToPermissionedDatum({ ...CANDIDATE_A, babe_pub_key: BABE })[1],
      ).toEqual([
        [KEY_IDS.aura, CANDIDATE_A.aura_pub_key],
        [KEY_IDS.gran, CANDIDATE_A.grandpa_pub_key],
        [KEY_IDS.beef, CANDIDATE_A.beefy_pub_key],
        [KEY_IDS.babe, BABE],
      ]);
    });
  });
});

describe("FederatedOps decode", () => {
  const bytes = (hex: string) => PlutusData.newBytes(Buffer.from(hex, "hex"));
  const list = (...items: PlutusData[]) => {
    const l = new PlutusList();
    for (const item of items) l.add(item);
    return PlutusData.newList(l);
  };
  const key = (id: string, value: string) => list(bytes(id), bytes(value));
  const unit = PlutusData.fromCore({ constructor: 0n, fields: { items: [] } });
  const datum = (...keys: PlutusData[]) =>
    list(
      unit,
      list(list(bytes("aabb"), list(...keys))),
      PlutusData.newInteger(1n),
    );
  const decode = decodeFederatedOps;

  test("keeps aura, gran, beef and babe", () => {
    const babe = toHex(new TextEncoder().encode("babe"));
    const { candidates } = Either.getOrThrow(
      decode(
        datum(
          key(KEY_IDS.aura, "01"),
          key(KEY_IDS.gran, "02"),
          key(KEY_IDS.beef, "03"),
          key(babe, "04"),
        ),
      ),
    );
    expect(candidates).toMatchObject([
      {
        sidechain_pub_key: "aabb",
        aura_pub_key: "01",
        grandpa_pub_key: "02",
        beefy_pub_key: "03",
        babe_pub_key: "04",
      },
    ]);
  });

  test.each([
    ["v1", undefined],
    ["v2", ""],
  ])("%s encodes a babe key and decodes it back", (_shape, message) => {
    const data = {
      data: unit,
      message,
      candidates: [
        {
          sidechain_pub_key: "aabb",
          aura_pub_key: "01",
          grandpa_pub_key: "02",
          beefy_pub_key: "03",
          babe_pub_key: "04",
        },
      ],
    };
    expect(Either.getOrThrow(decode(encodeFederatedOps(data)))).toEqual(data);
  });

  test("refuses a list that is neither v1 nor v2", () => {
    expect(
      leftOf(decode(list(unit, PlutusData.newInteger(1n)))).reason,
    ).toContain("expected a list of 3 (v1) or 4 (v2) elements");
  });

  test.each([
    ["an unknown key id", [key("78787878", "01")], "unknown key id 78787878"],
    [
      "a 3-element key tuple",
      [list(bytes(KEY_IDS.aura), bytes("01"), bytes("02"))],
      "expected a 2-element list",
    ],
  ])("rejects %s", (_name, keys, reason) => {
    expect(leftOf(decode(datum(...keys))).reason).toContain(reason);
  });
});

import { describe, test, expect } from "bun:test";
import { toHex } from "@blaze-cardano/core";
import {
  parsePermissionedCandidatesString,
  candidateToPermissionedDatum,
  createFederatedOpsDatumFromString,
  type PermissionedCandidate,
} from "../cli/lib/candidates";

// Expected 4-char key identifiers as hex
const KEY_IDS = {
  aura: toHex(new TextEncoder().encode("aura")), // 61757261
  gran: toHex(new TextEncoder().encode("gran")), // 6772616e
  beef: toHex(new TextEncoder().encode("beef")), // 62656566
};

describe("Candidates Parser", () => {
  const singleCandidateInput = `[
    {
      sidechain_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8,
      aura_pub_key:1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03,
      grandpa_pub_key:5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5,
      beefy_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8
    }
  ]`;

  const multipleCandidatesInput = `[
    {
      sidechain_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8,
      aura_pub_key:1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03,
      grandpa_pub_key:5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5,
      beefy_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8
    },
    {
      sidechain_pub_key:0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a,
      aura_pub_key:b0521e374b0586d6829dad320753c62cdc6ef5edbd37ffdd36da0ae97c521819,
      grandpa_pub_key:3f7f2fc8829c649501a0fb72a79abf885aa89e6c4ee2d00c6041dfa85e320980,
      beefy_pub_key:0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a
    },
    {
      sidechain_pub_key:0291f1217d5a04cb83312ee3d88a6e6b33284e053e6ccfc3a90339a0299d12967c,
      aura_pub_key:1cbd2d43530a44705ad088af313e18f80b53ef16b36177cd4b77b846f2a5f07c,
      grandpa_pub_key:568cb4a574c6d178feb39c27dfc8b3f789e5f5423e19c71633c748b9acf086b5,
      beefy_pub_key:0291f1217d5a04cb83312ee3d88a6e6b33284e053e6ccfc3a90339a0299d12967c
    }
  ]`;

  describe("parsePermissionedCandidatesString", () => {
    test("parses a single candidate correctly", () => {
      const candidates =
        parsePermissionedCandidatesString(singleCandidateInput);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].sidechain_pub_key).toBe(
        "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
      );
      expect(candidates[0].aura_pub_key).toBe(
        "1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03",
      );
      expect(candidates[0].grandpa_pub_key).toBe(
        "5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5",
      );
      expect(candidates[0].beefy_pub_key).toBe(
        "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
      );
    });

    test("parses multiple candidates correctly", () => {
      const candidates = parsePermissionedCandidatesString(
        multipleCandidatesInput,
      );

      expect(candidates).toHaveLength(3);

      // Check first candidate
      expect(candidates[0].sidechain_pub_key).toBe(
        "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
      );

      // Check second candidate
      expect(candidates[1].sidechain_pub_key).toBe(
        "0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a",
      );
      expect(candidates[1].aura_pub_key).toBe(
        "b0521e374b0586d6829dad320753c62cdc6ef5edbd37ffdd36da0ae97c521819",
      );

      // Check third candidate
      expect(candidates[2].sidechain_pub_key).toBe(
        "0291f1217d5a04cb83312ee3d88a6e6b33284e053e6ccfc3a90339a0299d12967c",
      );
    });

    test("throws error for input not wrapped in brackets", () => {
      expect(() =>
        parsePermissionedCandidatesString("{sidechain_pub_key:abc}"),
      ).toThrow("Expected input to be wrapped in [ ]");
    });

    test("throws error for missing required field", () => {
      const invalidInput = `[
        {
          sidechain_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8,
          aura_pub_key:1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03
        }
      ]`;
      expect(() => parsePermissionedCandidatesString(invalidInput)).toThrow(
        "missing required field",
      );
    });

    test("throws error for invalid hex value", () => {
      const invalidInput = `[
        {
          sidechain_pub_key:invalidhex!!!,
          aura_pub_key:1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03,
          grandpa_pub_key:5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5,
          beefy_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8
        }
      ]`;
      expect(() => parsePermissionedCandidatesString(invalidInput)).toThrow(
        "invalid hex value",
      );
    });

    test("handles various whitespace formats", () => {
      // Compact format with minimal whitespace
      const compactInput = `[{sidechain_pub_key:aabb,aura_pub_key:ccdd,grandpa_pub_key:eeff,beefy_pub_key:1122}]`;
      const candidates = parsePermissionedCandidatesString(compactInput);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].sidechain_pub_key).toBe("aabb");
      expect(candidates[0].aura_pub_key).toBe("ccdd");
    });
  });

  describe("candidateToPermissionedDatum", () => {
    test("converts candidate to PermissionedCandidateDatumV1 format", () => {
      const candidate: PermissionedCandidate = {
        sidechain_pub_key:
          "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
        aura_pub_key:
          "1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03",
        grandpa_pub_key:
          "5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5",
        beefy_pub_key:
          "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
      };

      const datum = candidateToPermissionedDatum(candidate);

      // Check structure: [sidechain_pub_key, [[id, bytes], [id, bytes], [id, bytes]]]
      expect(datum[0]).toBe(candidate.sidechain_pub_key);
      expect(datum[1]).toHaveLength(3);

      // Check candidate keys
      const [auraKey, granKey, beefKey] = datum[1];

      expect(auraKey[0]).toBe(KEY_IDS.aura);
      expect(auraKey[1]).toBe(candidate.aura_pub_key);

      expect(granKey[0]).toBe(KEY_IDS.gran);
      expect(granKey[1]).toBe(candidate.grandpa_pub_key);

      expect(beefKey[0]).toBe(KEY_IDS.beef);
      expect(beefKey[1]).toBe(candidate.beefy_pub_key);
    });
  });

  describe("createFederatedOpsDatumFromString", () => {
    test("creates FederatedOps datum with correct structure", () => {
      const datum = createFederatedOpsDatumFromString(singleCandidateInput, 0n);

      // FederatedOps = [Unit ({}), List<PermissionedCandidateDatumV1>, version]
      expect(datum[0]).toEqual({});
      expect(datum[1]).toHaveLength(1);
      expect(datum[2]).toBe(0n);
    });

    test("creates FederatedOps datum with multiple candidates", () => {
      const datum = createFederatedOpsDatumFromString(
        multipleCandidatesInput,
        0n,
      );

      expect(datum[0]).toEqual({});
      expect(datum[1]).toHaveLength(3);
      expect(datum[2]).toBe(0n);

      // Verify each candidate in the appendix
      const appendix = datum[1];
      expect(appendix[0][0]).toBe(
        "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
      );
      expect(appendix[1][0]).toBe(
        "0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a",
      );
      expect(appendix[2][0]).toBe(
        "0291f1217d5a04cb83312ee3d88a6e6b33284e053e6ccfc3a90339a0299d12967c",
      );
    });

    test("creates FederatedOps datum with custom version", () => {
      const datum = createFederatedOpsDatumFromString(singleCandidateInput, 5n);

      expect(datum[2]).toBe(5n);
    });
  });

  describe("key identifiers", () => {
    test("key IDs are correct 4-byte hex encodings", () => {
      expect(KEY_IDS.aura).toBe("61757261"); // "aura" in hex
      expect(KEY_IDS.gran).toBe("6772616e"); // "gran" in hex
      expect(KEY_IDS.beef).toBe("62656566"); // "beef" in hex
    });
  });
});

import { describe, test, expect } from "bun:test";
import {
  getPromotedValidatorHash,
  readVersionsJson,
  resolveValidatorNameByHash,
} from "../cli-yargs/lib/versions";

describe("getPromotedValidatorHash", () => {
  test("returns correct hash for a promoted v2 validator", () => {
    const hash = getPromotedValidatorHash("node-dev-2", "council_logic_v2");
    expect(hash).toBe(
      "6e7730adc040b4415b9498dfb2ca668381d958773b9952778cf5b5ff",
    );
  });

  test("returns null for non-existent validator name", () => {
    const hash = getPromotedValidatorHash("node-dev-2", "no_such_validator");
    expect(hash).toBeNull();
  });

  test("returns null for non-existent environment", () => {
    const hash = getPromotedValidatorHash("no-such-env", "council_logic_v2");
    expect(hash).toBeNull();
  });
});

describe("resolveValidatorNameByHash", () => {
  test("resolves v2 council logic hash to council_logic_v2", () => {
    const name = resolveValidatorNameByHash(
      "node-dev-2",
      "6e7730adc040b4415b9498dfb2ca668381d958773b9952778cf5b5ff",
    );
    expect(name).toBe("council_logic_v2");
  });

  test("resolves v1 council logic hash to council_logic", () => {
    const name = resolveValidatorNameByHash(
      "node-dev-2",
      "4190700e5bc227ca7ece7b5b59365cb9fc8680fdbe99ea3726e9fdeb",
    );
    expect(name).toBe("council_logic");
  });

  test("returns null for unknown hash", () => {
    const name = resolveValidatorNameByHash("node-dev-2", "deadbeef");
    expect(name).toBeNull();
  });

  test("returns null for non-existent environment", () => {
    const name = resolveValidatorNameByHash("no-such-env", "deadbeef");
    expect(name).toBeNull();
  });
});

describe("version-agnostic re-staging check", () => {
  test("known promoted hash is detected as re-stage", () => {
    const v2Hash = "6e7730adc040b4415b9498dfb2ca668381d958773b9952778cf5b5ff";
    const resolvedName = resolveValidatorNameByHash("node-dev-2", v2Hash);
    const versionsData = readVersionsJson("node-dev-2");

    // v2 hash resolves to council_logic_v2, which is in promoted list
    expect(resolvedName).toBe("council_logic_v2");
    expect(versionsData?.promoted.includes(resolvedName!)).toBe(true);
  });

  test("unknown hash is NOT detected as re-stage", () => {
    const unknownHash =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const resolvedName = resolveValidatorNameByHash("node-dev-2", unknownHash);

    // Unknown hash resolves to null — not a re-stage
    expect(resolvedName).toBeNull();
  });

  test("v1 promoted hash is also detected as re-stage", () => {
    const v1Hash = "4190700e5bc227ca7ece7b5b59365cb9fc8680fdbe99ea3726e9fdeb";
    const resolvedName = resolveValidatorNameByHash("node-dev-2", v1Hash);
    const versionsData = readVersionsJson("node-dev-2");

    // v1 hash resolves to council_logic, which is also in promoted list
    expect(resolvedName).toBe("council_logic");
    expect(versionsData?.promoted.includes(resolvedName!)).toBe(true);
  });
});

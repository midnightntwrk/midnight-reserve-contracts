import { describe, test, expect } from "bun:test";
import {
  getPromotedValidatorHash,
  readVersionsJson,
  resolveValidatorNameByHash,
} from "../cli-yargs/lib/versions";

describe("getPromotedValidatorHash", () => {
  test("returns correct hash for a promoted v2 validator", () => {
    const hash = getPromotedValidatorHash(
      "node-dev-2",
      "federated_ops_logic_v2",
    );
    expect(hash).toBe(
      "4bd358f88dad3c17972d094ac405386667b4160b0b7ca87ee14e56d3",
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
  test("resolves v2 federated_ops logic hash to federated_ops_logic_v2", () => {
    const name = resolveValidatorNameByHash(
      "node-dev-2",
      "4bd358f88dad3c17972d094ac405386667b4160b0b7ca87ee14e56d3",
    );
    expect(name).toBe("federated_ops_logic_v2");
  });

  test("resolves v1 council logic hash to council_logic", () => {
    const name = resolveValidatorNameByHash(
      "node-dev-2",
      "880a920778433c9cc721fc5c699d4f59573fd9009d7b47d007734fd1",
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
    const v2Hash = "4bd358f88dad3c17972d094ac405386667b4160b0b7ca87ee14e56d3";
    const resolvedName = resolveValidatorNameByHash("node-dev-2", v2Hash);
    const versionsData = readVersionsJson("node-dev-2");

    // v2 hash resolves to federated_ops_logic_v2, which is in promoted list
    expect(resolvedName).toBe("federated_ops_logic_v2");
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
    const v1Hash = "880a920778433c9cc721fc5c699d4f59573fd9009d7b47d007734fd1";
    const resolvedName = resolveValidatorNameByHash("node-dev-2", v1Hash);
    const versionsData = readVersionsJson("node-dev-2");

    // v1 hash resolves to council_logic, which is also in promoted list
    expect(resolvedName).toBe("council_logic");
    expect(versionsData?.promoted.includes(resolvedName!)).toBe(true);
  });
});

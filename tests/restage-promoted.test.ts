import { describe, test, expect } from "bun:test";
import {
  getPromotedValidatorHash,
  resolveValidatorNameByHash,
} from "../cli-yargs/lib/versions";

describe("getPromotedValidatorHash", () => {
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
  test("unknown hash is NOT detected as re-stage", () => {
    const unknownHash =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const resolvedName = resolveValidatorNameByHash("node-dev-2", unknownHash);

    // Unknown hash resolves to null — not a re-stage
    expect(resolvedName).toBeNull();
  });
});

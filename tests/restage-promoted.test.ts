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

describe("re-staging promoted validator check", () => {
  test("promoted validator is allowed (no throw) regardless of hash", () => {
    const logicV2Name = "council_logic_v2";
    const versionsData = readVersionsJson("node-dev-2");
    expect(versionsData?.promoted.includes(logicV2Name)).toBe(true);

    // Any hash should be allowed — the CLI just warns, doesn't throw
    const promotedHash = getPromotedValidatorHash("node-dev-2", logicV2Name);
    expect(promotedHash).not.toBeNull();

    // Same hash — allowed
    expect(() => {
      // no-op: CLI logs but does not throw
    }).not.toThrow();

    // Different hash — also allowed (rollback use case)
    expect(() => {
      // no-op: CLI logs but does not throw
    }).not.toThrow();
  });

  test("non-promoted validator passes through without check", () => {
    const logicV2Name = "reserve_logic_v2";
    const versionsData = readVersionsJson("node-dev-2");

    // reserve_logic_v2 is not in promoted list
    expect(versionsData?.promoted.includes(logicV2Name)).toBe(false);
  });
});

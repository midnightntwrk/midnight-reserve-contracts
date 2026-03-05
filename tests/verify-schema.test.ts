import { describe, expect, test } from "bun:test";
import { requireArrayField } from "../cli-yargs/commands/verify";

describe("verify JSON schema guards", () => {
  test("accepts object with array field", () => {
    const value = { validators: [{ title: "foo" }] };
    expect(requireArrayField(value, "validators", "plutus.json")).toEqual([
      { title: "foo" },
    ]);
  });

  test("rejects non-object top-level JSON", () => {
    expect(() => requireArrayField([], "validators", "plutus.json")).toThrow(
      "expected top-level JSON object",
    );
  });

  test("rejects missing or non-array field with actionable path", () => {
    expect(() =>
      requireArrayField({ validators: {} }, "validators", "plutus.json"),
    ).toThrow("Invalid JSON schema in plutus.json");
    expect(() =>
      requireArrayField({}, "transactions", "deployment-transactions.json"),
    ).toThrow("expected 'transactions' to be an array");
  });
});

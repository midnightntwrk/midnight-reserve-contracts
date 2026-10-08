import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  getPromotedValidatorHash,
  resolveValidatorNameByHash,
} from "../cli-yargs/lib/versions";

const devnetPlutus: { validators: { title: string; hash: string }[] } =
  JSON.parse(
    readFileSync(
      resolve(import.meta.dir, "../deployed-scripts/devnet/plutus.json"),
      "utf-8",
    ),
  );
const councilLogicHash = devnetPlutus.validators.find(
  (v) => v.title === "permissioned.council_logic.else",
)!.hash;

describe("getPromotedValidatorHash", () => {
  test("returns the deployed hash for a validator name", () => {
    expect(getPromotedValidatorHash("devnet", "council_logic")).toBe(
      councilLogicHash,
    );
  });

  test("returns null for non-existent validator name", () => {
    expect(getPromotedValidatorHash("devnet", "no_such_validator")).toBeNull();
  });
});

describe("resolveValidatorNameByHash", () => {
  test("resolves a deployed hash to the name without the .else suffix", () => {
    expect(resolveValidatorNameByHash("devnet", councilLogicHash)).toBe(
      "council_logic",
    );
  });

  test("returns null for unknown hash", () => {
    expect(resolveValidatorNameByHash("devnet", "deadbeef")).toBeNull();
  });
});

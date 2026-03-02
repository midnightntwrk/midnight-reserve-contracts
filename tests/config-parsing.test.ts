import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getCouncilThreshold,
  getSimpleTxAmount,
  getSimpleTxCount,
  loadAikenConfig,
} from "../cli-yargs/lib/config";

const ENV_KEYS = ["COUNCIL_THRESHOLD", "SIMPLE_TX_COUNT", "SIMPLE_TX_AMOUNT"];

let envSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = envSnapshot[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

function withTempAikenToml(contents: string, run: () => void): void {
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), "aiken-config-test-"));

  writeFileSync(join(tempDir, "aiken.toml"), contents);
  process.chdir(tempDir);

  try {
    run();
  } finally {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("threshold parsing from env", () => {
  test("uses defaults when env is unset", () => {
    delete process.env.COUNCIL_THRESHOLD;
    expect(getCouncilThreshold()).toEqual({ numerator: 2n, denominator: 3n });
  });

  test("trims threshold parts around slash", () => {
    process.env.COUNCIL_THRESHOLD = " 1 / 2 ";
    expect(getCouncilThreshold()).toEqual({ numerator: 1n, denominator: 2n });
  });

  test("rejects denominator <= 0", () => {
    process.env.COUNCIL_THRESHOLD = "1/0";
    expect(() => getCouncilThreshold()).toThrow("denominator must be greater than zero");
  });

  test("rejects numerator < 0", () => {
    process.env.COUNCIL_THRESHOLD = "-1/3";
    expect(() => getCouncilThreshold()).toThrow("numerator must be non-negative");
  });

  test("rejects numerator > denominator", () => {
    process.env.COUNCIL_THRESHOLD = "4/3";
    expect(() => getCouncilThreshold()).toThrow(
      "numerator must be less than or equal to denominator",
    );
  });
});

describe("simple tx env parsing", () => {
  test("uses defaults when env vars are unset", () => {
    delete process.env.SIMPLE_TX_COUNT;
    delete process.env.SIMPLE_TX_AMOUNT;

    expect(getSimpleTxCount()).toBe(16);
    expect(getSimpleTxAmount()).toBe(20_000_000n);
  });

  test("rejects invalid SIMPLE_TX_COUNT values", () => {
    for (const value of ["0", "-1", "1.2", "1e3", "abc"]) {
      process.env.SIMPLE_TX_COUNT = value;
      expect(() => getSimpleTxCount()).toThrow("SIMPLE_TX_COUNT");
    }
  });

  test("rejects invalid SIMPLE_TX_AMOUNT values", () => {
    for (const value of ["0", "-1", "abc"]) {
      process.env.SIMPLE_TX_AMOUNT = value;
      expect(() => getSimpleTxAmount()).toThrow("SIMPLE_TX_AMOUNT");
    }
  });
});

describe("loadAikenConfig validation errors", () => {
  test("fails clearly when top-level config table is missing", () => {
    withTempAikenToml("[other]\nvalue = 1\n", () => {
      expect(() => loadAikenConfig("mainnet")).toThrow(
        "Invalid aiken.toml: expected 'config' to be a table/object",
      );
    });
  });

  test("fails clearly when selected config section is not an object", () => {
    withTempAikenToml("[config]\nmainnet = 'oops'\n", () => {
      expect(() => loadAikenConfig("mainnet")).toThrow(
        "expected 'config.mainnet' to be a table/object",
      );
    });
  });

  test("fails clearly when hash field does not contain bytes", () => {
    withTempAikenToml(
      [
        "[config.mainnet]",
        "technical_authority_one_shot_index = 0",
        "",
        "[config.mainnet.technical_authority_one_shot_hash]",
        "value = 'not-bytes'",
        "",
      ].join("\n"),
      () => {
        expect(() => loadAikenConfig("mainnet")).toThrow(
          "config.mainnet.technical_authority_one_shot_hash.bytes",
        );
      },
    );
  });

  test("fails clearly when index field is not an integer", () => {
    withTempAikenToml(
      [
        "[config.mainnet]",
        "technical_authority_one_shot_index = 1.5",
        "",
        "[config.mainnet.technical_authority_one_shot_hash]",
        "bytes = 'abcd'",
        "",
      ].join("\n"),
      () => {
        expect(() => loadAikenConfig("mainnet")).toThrow(
          "config.mainnet.technical_authority_one_shot_index",
        );
      },
    );
  });
});

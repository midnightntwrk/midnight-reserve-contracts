import { describe, expect, test } from "bun:test";
import { parseSignersWithCount } from "../cli-yargs/lib/signers";

const ENV_VAR = "TEST_SIGNERS_WITH_COUNT";
const HASH_A = "a".repeat(56);
const HASH_B = "b".repeat(56);
const KEY_A = "1".repeat(64);
const KEY_B = "2".repeat(64);

function withSignerEnv(value: string, run: () => void): void {
  const previousValue = process.env[ENV_VAR];
  process.env[ENV_VAR] = value;

  try {
    run();
  } finally {
    if (previousValue === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = previousValue;
    }
  }
}

describe("parseSignersWithCount", () => {
  test("parses valid signer pairs and returns bigint count", () => {
    withSignerEnv(` ${HASH_A} : ${KEY_A} , ${HASH_B}:${KEY_B} `, () => {
      const result = parseSignersWithCount(ENV_VAR);

      expect(result.totalSigners).toBe(2n);
      expect(result.signers).toEqual({
        [HASH_A]: KEY_A,
        [HASH_B]: KEY_B,
      });
    });
  });

  const malformedCases: Array<{
    name: string;
    value: string;
    errorPart: string;
  }> = [
    {
      name: "empty signer segment",
      value: `${HASH_A}:${KEY_A},`,
      errorPart: "is empty",
    },
    {
      name: "missing payment hash",
      value: `:${KEY_A}`,
      errorPart: "must include non-empty payment hash and sr25519 key",
    },
    {
      name: "missing sr25519 key",
      value: `${HASH_A}:`,
      errorPart: "must include non-empty payment hash and sr25519 key",
    },
    {
      name: "extra colon delimiter",
      value: `${HASH_A}:${KEY_A}:abcd`,
      errorPart: "must contain exactly one ':' delimiter",
    },
  ];

  for (const { name, value, errorPart } of malformedCases) {
    test(`throws for malformed signer pair: ${name}`, () => {
      withSignerEnv(value, () => {
        expect(() => parseSignersWithCount(ENV_VAR)).toThrow(ENV_VAR);
        expect(() => parseSignersWithCount(ENV_VAR)).toThrow(errorPart);
      });
    });
  }

  test("accepts duplicate payment hashes and preserves weighted total", () => {
    withSignerEnv(`${HASH_A}:${KEY_A}, ${HASH_A}:${KEY_B}`, () => {
      const result = parseSignersWithCount(ENV_VAR);

      expect(result.totalSigners).toBe(2n);
      expect(result.signers[HASH_A]).toBe(KEY_B);
      expect(result.signerEntries).toEqual([
        { paymentHash: HASH_A, sr25519Key: KEY_A },
        { paymentHash: HASH_A, sr25519Key: KEY_B },
      ]);
    });
  });
});

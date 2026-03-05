import { describe, expect, test } from "bun:test";
import { formatLovelaceToAda } from "../cli-yargs/lib/output";

describe("formatLovelaceToAda", () => {
  test("formats common whole and fractional ADA amounts", () => {
    expect(formatLovelaceToAda(0n)).toBe("0.000000");
    expect(formatLovelaceToAda(1n)).toBe("0.000001");
    expect(formatLovelaceToAda(1_234_567n)).toBe("1.234567");
    expect(formatLovelaceToAda(42_000_000n)).toBe("42.000000");
  });

  test("formats very large lovelace values without precision loss", () => {
    const large = 12_345_678_901_234_567_890_123_456n;
    expect(formatLovelaceToAda(large)).toBe("12345678901234567890.123456");
  });

  test("formats negative values with sign preserved", () => {
    expect(formatLovelaceToAda(-1_000_001n)).toBe("-1.000001");
  });
});

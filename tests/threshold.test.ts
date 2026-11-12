import { describe, expect, test } from "bun:test";
import { Either } from "effect";
import { parseThreshold } from "../cli/governance/threshold";

describe("parseThreshold", () => {
  test.each([
    ["2/3", Either.right({ numerator: 2n, denominator: 3n })],
    [" 0 / 1 ", Either.right({ numerator: 0n, denominator: 1n })],
    ["3/3", Either.left("numerator must be less than denominator")],
    ["-1/3", Either.left("numerator must be non-negative")],
    ["1/0", Either.left("denominator must be greater than zero")],
    ["1/2/3", Either.left("expected 'numerator/denominator' (e.g. '2/3')")],
    ["a/b", Either.left("expected 'numerator/denominator' (e.g. '2/3')")],
    ["/3", Either.left("expected 'numerator/denominator' (e.g. '2/3')")],
    ["2", Either.left("expected 'numerator/denominator' (e.g. '2/3')")],
  ])("parseThreshold %s", (text, expected) => {
    expect(parseThreshold(text)).toEqual(expected);
  });
});

import { describe, expect, test } from "bun:test";
import { thresholdToRequiredSigners } from "../cli-yargs/lib/validation";

describe("thresholdToRequiredSigners", () => {
   test("computes ceiling signer count", () => {
      expect(thresholdToRequiredSigners(3, 2n, 3n, "tech auth threshold")).toBe(2);
      expect(thresholdToRequiredSigners(5, 1n, 2n, "council threshold")).toBe(3);
      expect(thresholdToRequiredSigners(4, 0n, 1n, "council threshold")).toBe(0);
   });

   test("rejects invalid denominator", () => {
      expect(() => thresholdToRequiredSigners(3, 1n, 0n, "threshold")).toThrow(
         "denominator must be greater than zero",
      );
   });

   test("rejects invalid numerator domain", () => {
      expect(() => thresholdToRequiredSigners(3, -1n, 3n, "threshold")).toThrow(
         "numerator must be between 0 and denominator",
      );
      expect(() => thresholdToRequiredSigners(3, 4n, 3n, "threshold")).toThrow(
         "numerator must be between 0 and denominator",
      );
   });

   test("rejects invalid total signer count", () => {
      expect(() => thresholdToRequiredSigners(-1, 1n, 2n, "threshold")).toThrow(
         "total signers must be a non-negative integer",
      );
      expect(() => thresholdToRequiredSigners(1.5, 1n, 2n, "threshold")).toThrow(
         "total signers must be a non-negative integer",
      );
   });
});

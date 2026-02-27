import { describe, test, expect } from "bun:test";
import { enrichErrorMessage } from "../cli-yargs/lib/redeemer-mapping";
import type { RedeemerMapping } from "../cli-yargs/lib/redeemer-mapping";

describe("redeemer-mapping", () => {
  describe("enrichErrorMessage", () => {
    const mapping: RedeemerMapping = {
      "spend[0]": "CouncilForeverElse",
      "withdraw[0]": "CouncilLogicV2Else",
      "mint[0]": "TechAuthWitnessPolicy",
      "mint[1]": "CouncilWitnessPolicy",
    };

    test("replaces known redeemer indices with validator names", () => {
      const msg = "Script failure at withdraw[0]";
      expect(enrichErrorMessage(msg, mapping)).toBe(
        "Script failure at withdraw[0] (CouncilLogicV2Else)",
      );
    });

    test("replaces multiple indices in one message", () => {
      const msg = "Failed: spend[0] and mint[1] both failed";
      const result = enrichErrorMessage(msg, mapping);
      expect(result).toContain("spend[0] (CouncilForeverElse)");
      expect(result).toContain("mint[1] (CouncilWitnessPolicy)");
    });

    test("leaves unknown indices unchanged", () => {
      const msg = "Script failure at spend[5]";
      expect(enrichErrorMessage(msg, mapping)).toBe(msg);
    });

    test("handles empty mapping gracefully", () => {
      const msg = "Script failure at withdraw[0]";
      expect(enrichErrorMessage(msg, {})).toBe(msg);
    });

    test("handles message with no redeemer references", () => {
      const msg = "Some other error";
      expect(enrichErrorMessage(msg, mapping)).toBe(msg);
    });

    test("is case-insensitive for redeemer category", () => {
      const msg = "Failed at Spend[0] and Withdraw[0]";
      const result = enrichErrorMessage(msg, mapping);
      expect(result).toContain("(CouncilForeverElse)");
      expect(result).toContain("(CouncilLogicV2Else)");
    });

    test("handles reward[] references", () => {
      const rewardMapping: RedeemerMapping = {
        "reward[0]": "SomeRewardValidator",
      };
      const msg = "Error at reward[0]";
      expect(enrichErrorMessage(msg, rewardMapping)).toBe(
        "Error at reward[0] (SomeRewardValidator)",
      );
    });
  });
});

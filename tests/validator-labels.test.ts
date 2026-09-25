import { describe, test, expect } from "bun:test";
import {
  labelValidators,
  type ValidatorLabels,
} from "../cli/chain/validator-labels";

describe("validator-labels", () => {
  describe("labelValidators", () => {
    const labels: ValidatorLabels = {
      "spend[0]": "CouncilForeverElse",
      "withdraw[0]": "CouncilLogicV2Else",
      "mint[0]": "TechAuthWitnessPolicy",
      "mint[1]": "CouncilWitnessPolicy",
    };

    test.each([
      [
        "names a known index",
        "Script failure at withdraw[0]",
        labels,
        "Script failure at withdraw[0] (CouncilLogicV2Else)",
      ],
      [
        "names every index in one message",
        "Failed: spend[0] and mint[1] both failed",
        labels,
        "Failed: spend[0] (CouncilForeverElse) and mint[1] (CouncilWitnessPolicy) both failed",
      ],
      [
        "leaves an unknown index unchanged",
        "Script failure at spend[5]",
        labels,
        "Script failure at spend[5]",
      ],
      [
        "matches the category in any case",
        "Failed at Spend[0] and Withdraw[0]",
        labels,
        "Failed at Spend[0] (CouncilForeverElse) and Withdraw[0] (CouncilLogicV2Else)",
      ],
      [
        "names a reward reference, the ledger's withdrawal tag, by its withdraw validator",
        "Error at Reward[0] and reward[1]",
        { "withdraw[0]": "CouncilLogicV2Else", "withdraw[1]": "TechAuthLogic" },
        "Error at Reward[0] (CouncilLogicV2Else) and reward[1] (TechAuthLogic)",
      ],
      [
        "names the Withdraw tag the UPLC evaluator prints",
        "failed script execution\n     Withdraw[0] the validator crashed",
        labels,
        "failed script execution\n     Withdraw[0] (CouncilLogicV2Else) the validator crashed",
      ],
    ] satisfies [string, string, ValidatorLabels, string][])(
      "%s",
      (_name, msg, map, expected) => {
        expect(labelValidators(msg, map)).toBe(expected);
      },
    );
  });
});

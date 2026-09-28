/**
 * The batch planner (docs/rewards/spec.md §5.3): which leaves a Pay pays
 * and the lookahead it reveals, under the run rules of lib/rewards/batch.ak. The rewards end-to-end test runs its plans through
 * the real scripts.
 */
import { describe, expect, test } from "bun:test";
import { concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { Option } from "effect";
import { planBatch, type RewardLeaf, rewardLeaf } from "../cli/rewards/batch";
const leafOf = (key: string, amount: bigint): RewardLeaf =>
  rewardLeaf(
    concatBytes(
      Uint8Array.of(0),
      hexToBytes(key),
      hexToBytes(amount.toString(16).padStart(32, "0")),
    ),
  );

const seven = [1, 2, 3, 4, 5, 6, 7].map((i) =>
  leafOf(i.toString(16).padStart(2, "0").repeat(28), BigInt(i)),
);

describe("planBatch", () => {
  test("a run from min_key stops at the limit and reveals the next leaf", () => {
    expect(planBatch(seven, 0, 3)).toEqual({
      paid: [0, 1, 2],
      lookahead: Option.some(3),
    });
  });

  test("a run that reaches max_key pays it and reveals no lookahead", () => {
    expect(planBatch(seven, 3, 5)).toEqual({
      paid: [3, 4, 5, 6],
      lookahead: Option.none(),
    });
  });

  test("max_key is never a lookahead: the leaf before it pays it too, past the limit", () => {
    expect(planBatch(seven, 5, 1)).toEqual({
      paid: [5, 6],
      lookahead: Option.none(),
    });
  });
});

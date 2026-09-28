/**
 * The batch planner (docs/rewards/spec.md §5.3): which leaves a Pay pays
 * after the cursor it reveals, under the run rules of lib/rewards/batch.ak.
 * The rewards end-to-end test runs its plans through the real scripts.
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
  test("an epoch's first run pays from the first leaf up to the limit", () => {
    expect(planBatch(seven, Option.none(), 3)).toEqual({
      cursor: Option.none(),
      paid: [0, 1, 2],
    });
  });

  test("a later run reveals the cursor and pays the leaves after it", () => {
    expect(planBatch(seven, Option.some(2), 3)).toEqual({
      cursor: Option.some(2),
      paid: [3, 4, 5],
    });
  });

  test("a run stops at max_key", () => {
    expect(planBatch(seven, Option.some(4), 5)).toEqual({
      cursor: Option.some(4),
      paid: [5, 6],
    });
  });
});

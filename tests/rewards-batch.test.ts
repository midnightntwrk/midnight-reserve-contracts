/**
 * The batch planner (docs/rewards/spec.md §5.3): which leaves a batch pays,
 * the lookahead it reveals and the cursor it leaves, under the run rules of
 * lib/rewards/batch.ak. The rewards end-to-end test runs its plans through
 * the real scripts.
 */
import { describe, expect, test } from "bun:test";
import { concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { Either, Option } from "effect";
import {
  loadStart,
  planBatch,
  type RewardLeaf,
  rewardLeaf,
} from "../cli/rewards/batch";
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
const always = () => true;

describe("planBatch", () => {
  test("a load at max_key pays it alone and wraps the cursor to min_key", () => {
    expect(planBatch(seven, loadStart(seven), 6, 3, always)).toEqual(
      Either.right({
        paid: [6],
        lookahead: Option.none(),
        cursor: seven[0].key,
        complete: false,
      }),
    );
  });

  test("a run stops at the limit and reveals the next leaf as its lookahead", () => {
    expect(planBatch(seven, 0, 6, 3, always)).toEqual(
      Either.right({
        paid: [0, 1, 2],
        lookahead: Option.some(3),
        cursor: seven[3].key,
        complete: false,
      }),
    );
  });

  test("a run that reaches the start completes the fold", () => {
    expect(planBatch(seven, 3, 6, 5, always)).toEqual(
      Either.right({
        paid: [3, 4, 5],
        lookahead: Option.some(6),
        cursor: seven[6].key,
        complete: true,
      }),
    );
  });

  test("a run stops where the next deposit's input sorts before the last", () => {
    expect(
      Either.map(
        planBatch(seven, 0, 6, 5, (a) => a !== 1),
        (p) => p.paid,
      ),
    ).toEqual(Either.right([0, 1]));
  });

  test("a run must pay max_key with the leaf before it", () => {
    expect(planBatch(seven, 5, 0, 1, always)).toEqual(
      Either.right({
        paid: [5, 6],
        lookahead: Option.none(),
        cursor: seven[0].key,
        complete: true,
      }),
    );
    expect(Either.isLeft(planBatch(seven, 5, 0, 1, () => false))).toBe(true);
  });
});

import { expect, test } from "bun:test";
import { buildSimpleTx } from "../cli/wallet/simple-tx";
import { asFunded, keyAddress } from "./helpers/fixtures";

const recipient = keyAddress("11".repeat(28));

test("buildSimpleTx pays `count` outputs of `amount` to the recipient", () =>
  asFunded(async (emulator, blaze) => {
    await emulator.expectValidTransaction(
      blaze,
      buildSimpleTx(blaze, { recipient, count: 3, amount: 5_000_000n }),
    );
    const paid = await blaze.provider.getUnspentOutputs(recipient);
    expect(paid.map((u) => u.output().amount().coin())).toEqual([
      5_000_000n,
      5_000_000n,
      5_000_000n,
    ]);
  }));

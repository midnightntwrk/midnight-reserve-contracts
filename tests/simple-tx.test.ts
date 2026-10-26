import { expect, test } from "bun:test";
import { Option } from "effect";
import { toTxBuilder } from "../cli/tx/compile";
import { planSimpleTx } from "../cli/wallet/simple-tx";
import { asFunded, keyAddress } from "./helpers/fixtures";

const recipient = keyAddress("11".repeat(28));

test("planSimpleTx pays `count` outputs of `amount` to the recipient", () =>
  asFunded(async (emulator, blaze, addr) => {
    await emulator.expectValidTransaction(
      blaze,
      toTxBuilder(
        blaze,
        planSimpleTx({ recipient, count: 3, amount: 5_000_000n }),
        { changeAddress: addr, feePadding: 0n, metadata: Option.none() },
      ),
    );
    const paid = await blaze.provider.getUnspentOutputs(recipient);
    expect(paid.map((u) => u.output().amount().coin())).toEqual([
      5_000_000n,
      5_000_000n,
      5_000_000n,
    ]);
  }));

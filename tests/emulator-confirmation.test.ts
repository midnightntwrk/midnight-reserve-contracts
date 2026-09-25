/**
 * The emulator's confirmation lookup reflects its ledger (patched in
 * patches/@blaze-cardano%2Femulator@0.5.2.patch), so a rejected submission
 * fails instead of passing as "already confirmed on-chain".
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { TransactionId } from "@blaze-cardano/core";
import { submitTx } from "../cli/chain/submit";
import { Provider } from "../cli/chain/provider";
import {
  emulatorProgram,
  expectFailure,
  runTest,
  unsignedSimpleTx,
} from "./helpers/effect";

const onChain = (txId: TransactionId) =>
  Effect.flatMap(Provider, (provider) =>
    provider.use("awaitTransactionConfirmation", (p) =>
      p.awaitTransactionConfirmation(txId, 0),
    ),
  );

describe("submission on the emulator", () => {
  test("an unsigned transaction is rejected once and never counts as on chain", async () => {
    const { layer } = await emulatorProgram();
    const tx = await runTest(layer, unsignedSimpleTx);

    const error = await expectFailure(
      layer,
      submitTx(tx, "Simple Transaction"),
      "SubmitError",
    );
    expect(error.attempts).toBe(1);
    expect(await runTest(layer, onChain(tx.getId()))).toBe(false);
  });
});

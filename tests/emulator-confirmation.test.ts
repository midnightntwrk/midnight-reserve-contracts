/**
 * The emulator's confirmation lookup reflects its ledger (patched in
 * patches/@blaze-cardano%2Femulator@0.5.2.patch), so a rejected submission
 * fails instead of passing as "already confirmed on-chain".
 */
import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { Transaction, TransactionId } from "@blaze-cardano/core";
import { EmulatorProvider } from "@blaze-cardano/emulator";
import { submitTx } from "../cli/chain/submit";
import { Provider, ProviderOver } from "../cli/chain/provider";
import {
  captureOutput,
  emulatorProgram,
  expectFailure,
  LoggerCaptured,
  OutputCaptured,
  runTest,
  SettingsOver,
  unsignedSimpleTx,
} from "./helpers/effect";

/** The emulator behind a rate limiter that refuses the first submission with a 429. */
class RateLimitedOnce extends EmulatorProvider {
  private limited = false;
  override postTransactionToChain(tx: Transaction): Promise<TransactionId> {
    if (this.limited) return super.postTransactionToChain(tx);
    this.limited = true;
    return Promise.reject(
      Object.assign(new Error("Too Many Requests"), { status: 429 }),
    );
  }
}

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

  test("a rejection after a 429 is a SubmitError: the rate limiter refused the request, so it never reached the node", async () => {
    const { emulator, layer } = await emulatorProgram();
    const tx = await runTest(layer, unsignedSimpleTx);
    const capture = captureOutput();
    const rateLimited = Layer.mergeAll(
      SettingsOver("emulator"),
      ProviderOver(new RateLimitedOnce(emulator), "emulator"),
      OutputCaptured(capture),
      LoggerCaptured(capture),
    );

    const error = await expectFailure(
      rateLimited,
      submitTx(tx, "Simple Transaction"),
      "SubmitError",
    );
    expect(error.attempts).toBe(2);
  });
});

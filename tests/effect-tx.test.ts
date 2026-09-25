import { describe, expect, test } from "bun:test";
import { TransactionId } from "@blaze-cardano/core";
import { EmulatorProvider } from "@blaze-cardano/emulator";
import { Effect, Layer, Option } from "effect";
import { confirm, signAndSubmitOne } from "../cli/chain/sign-and-submit";
import { awaitConfirmation } from "../cli/chain/submit";
import {
  LoggerCaptured,
  OutputCaptured,
  onPreview,
  PreviewLive,
  captureOutput,
  emulatorProgram,
  expectFailure,
  runTest,
  SettingsOver,
  SettingsWith,
  testEnv,
  unsignedSimpleTx,
} from "./helpers/effect";
import { Provider, ProviderLive } from "../cli/chain/provider";
import { PREVIEW_DEPLOYMENT_TX } from "./helpers/fixtures";

describe("signAndSubmitOne on the emulator", () => {
  test("signs the entry with the deployer key and submits it; the confirmation follows", async () => {
    const { emulator, layer, deployer } = await emulatorProgram();
    const tx = await runTest(layer, unsignedSimpleTx);
    const txId = await runTest(
      layer,
      signAndSubmitOne(
        { cborHex: tx.toCbor(), description: "Simple Transaction" },
        Option.some(testEnv("SIGNING_PRIVATE_KEY")),
      ),
    );
    expect(txId).toBe(tx.getId());
    await runTest(layer, confirm(txId, "Simple Transaction"));
    const after = await new EmulatorProvider(emulator).getUnspentOutputs(
      deployer,
    );
    expect(after.some((u) => u.input().transactionId() === txId)).toBe(true);
  });
});

describe("ProviderLive", () => {
  test("kupmios connects on first use; a refused Ogmios socket renders its message", async () => {
    const layer = Layer.provide(
      ProviderLive("local", "kupmios"),
      SettingsWith("local", {
        KUPO_URL: "http://127.0.0.1:9",
        OGMIOS_URL: "ws://127.0.0.1:9",
      }),
    );
    await runTest(layer, Effect.asVoid(Provider));
    const error = await expectFailure(
      layer,
      Effect.flatMap(Provider, (provider) =>
        provider.use("getParameters", (p) => p.getParameters()),
      ),
      "ProviderError",
    );
    expect(error).toMatchObject({ op: "Ogmios.new", retryable: false });
  });

  test("blockfrost on an environment that is not a Cardano network fails the layer", async () => {
    const error = await expectFailure(
      Layer.provide(
        ProviderLive("local", "blockfrost"),
        SettingsWith("local", {}),
      ),
      Effect.asVoid(Provider),
      "BlockfrostUnavailable",
    );
    expect(error.environment).toBe("local");
  });
});

describe.if(onPreview)("awaitConfirmation on preview", () => {
  const capture = captureOutput();
  const layer = Layer.mergeAll(
    Layer.provide(ProviderLive("preview"), SettingsOver("preview")),
    PreviewLive,
    OutputCaptured(capture),
    LoggerCaptured(capture),
  );

  test("resolves for the confirmed preview deployment transaction", async () => {
    await runTest(
      layer,
      awaitConfirmation(TransactionId(PREVIEW_DEPLOYMENT_TX), "deployment"),
    );
  }, 60_000);
});

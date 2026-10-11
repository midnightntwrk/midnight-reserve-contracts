/** The reward-account check against preview. */
import { describe, expect, test } from "bun:test";
import { NetworkId } from "@blaze-cardano/core";
import { ConfigProvider, Layer } from "effect";
import { rewardAccountRegistered } from "../cli/chain/registration";
import { createRewardAccount } from "../cli/tx/scripts";
import { SettingsLive } from "../cli/config/settings";
import { expectFailure, onPreview, PlatformLive } from "./helpers/effect";
import { randomHash } from "./helpers/fixtures";

describe.if(onPreview)("rewardAccountRegistered on preview", () => {
  test("a bad API key is a ConfigError naming its variable", async () => {
    const badKey = Layer.setConfigProvider(
      ConfigProvider.fromMap(
        new Map([["BLOCKFROST_PREVIEW_API_KEY", `preview${"0".repeat(32)}`]]),
      ).pipe(ConfigProvider.orElse(() => ConfigProvider.fromEnv())),
    );
    const error = await expectFailure(
      Layer.mergeAll(
        Layer.provide(SettingsLive("preview"), PlatformLive),
        badKey,
        PlatformLive,
      ),
      rewardAccountRegistered(
        createRewardAccount(randomHash(28), NetworkId.Testnet),
        "preview",
      ),
      "ConfigError",
    );
    expect(error.key).toBe("BLOCKFROST_PREVIEW_API_KEY");
  }, 30_000);
});

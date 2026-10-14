/**
 * The UpgradeState decoder on the recorded mainnet council main; the
 * reward-account check against preview.
 */
import { describe, expect, test } from "bun:test";
import {
  Datum,
  HexBlob,
  NetworkId,
  PlutusData,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { ConfigProvider, Either, Layer } from "effect";
import {
  rewardAccountRegistered,
  upgradeStateAt,
} from "../cli/chain/governance-provider";
import { createRewardAccount } from "../cli/chain/transaction";
import { SettingsLive } from "../cli/config/settings";
import {
  expectFailure,
  leftOf,
  onPreview,
  PlatformLive,
} from "./helpers/effect";
import { randomHash } from "./helpers/fixtures";
import { mainnetSnapshotUtxos as snap } from "./helpers/mainnet-snapshot";

/** A UTxO at the council main's address carrying `cbor` as its inline datum. */
const withDatum = (cbor: string) => {
  const output = new TransactionOutput(
    snap.councilMain.output().address(),
    snap.councilMain.output().amount(),
  );
  output.setDatum(Datum.newInlineData(PlutusData.fromCbor(HexBlob(cbor))));
  return new TransactionUnspentOutput(snap.councilMain.input(), output);
};

describe("upgradeStateAt", () => {
  test("decodes the mainnet council main", () => {
    expect(upgradeStateAt(snap.councilMain)).toEqual(
      Either.right({
        logicHash: "8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef9718",
        mitigationLogicHash: "",
        authHash: "00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c",
        logicRound: 0,
      }),
    );
  });

  test.each([
    ["5 fields", "9f4040404000ff"],
    ["7 fields", "9f40404040000000ff"],
    ["an integer logic field", "9f004040400000ff"],
  ])("rejects a list of %s", (_name, cbor) => {
    expect(leftOf(upgradeStateAt(withDatum(cbor)))).toMatchObject({
      _tag: "DatumParseError",
      what: "UpgradeState",
      cbor,
    });
  });
});

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

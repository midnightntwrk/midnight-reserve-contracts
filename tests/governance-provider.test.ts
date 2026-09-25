/**
 * The UpgradeState decoder on the recorded mainnet two-stage UTxOs; the
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

/** The main gov-auth hash every mainnet UpgradeState names. */
const MAIN_AUTH = "00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c";

const mains = [
  {
    family: "council",
    main: snap.councilMain,
    logic: "8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef9718",
  },
  {
    family: "reserve",
    main: snap.reserveMain,
    logic: "bef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda",
  },
  {
    family: "ics",
    main: snap.icsMain,
    logic: "c4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b",
  },
  {
    family: "tech-auth",
    main: snap.techAuthMain,
    logic: "bc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d0",
  },
];

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
  test.each(mains)("decodes the mainnet $family main", ({ main, logic }) => {
    expect(upgradeStateAt(main)).toEqual(
      Either.right({
        logicHash: logic,
        mitigationLogicHash: "",
        authHash: MAIN_AUTH,
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

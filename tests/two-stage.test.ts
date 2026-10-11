/** The UpgradeState decoder on the recorded mainnet council main. */
import { describe, expect, test } from "bun:test";
import {
  Datum,
  HexBlob,
  PlutusData,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Either } from "effect";
import { upgradeStateAt } from "../cli/governance/two-stage";
import { leftOf } from "./helpers/effect";
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

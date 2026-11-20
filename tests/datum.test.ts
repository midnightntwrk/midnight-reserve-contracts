/** The datum codecs: signers with duplicate keys, logic_round, terms and FederatedOps v1/v2. */
import { PlutusData, PlutusList, toHex } from "@blaze-cardano/core";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import {
  candidateToPermissionedDatum,
  datumLogicRound,
  decodeFederatedOps,
  decodeSigners,
  decodeTerms,
  encodeFederatedOps,
  encodeMultisigState,
  encodeRedeemerMap,
  encodeTerms,
} from "../cli/datum";
import type { PermissionedCandidate, Signer } from "../cli/input";

const list = (...items: PlutusData[]) => {
  const plutusList = new PlutusList();
  for (const item of items) plutusList.add(item);
  return PlutusData.newList(plutusList);
};
const bytes = (hex: string) => PlutusData.newBytes(Buffer.from(hex, "hex"));
const unit = PlutusData.fromCore({ constructor: 0n, fields: { items: [] } });

const signersOf = (count: number) =>
  Array.from({ length: count }, (_, i): Signer => ({
    paymentHash: i.toString(16).padStart(56, "0"),
    sr25519Key: (i + 0x1000).toString(16).padStart(64, "0"),
  }));

const samePaymentHash = (keys: readonly string[]): Signer[] =>
  keys.map((key) => ({ paymentHash: "f9".repeat(28), sr25519Key: key }));

describe("signers", () => {
  it.live.each([0n, 1n])(
    "the same payment hash three times survives decode then encode, byte-equal, at round %d",
    (round) =>
      Effect.gen(function* () {
        const original = Result.getOrThrow(
          encodeMultisigState(
            samePaymentHash(["de", "8c", "f6"].map((b) => b.repeat(32))),
            round,
          ),
        );
        const decoded = yield* decodeSigners(original);
        expect(decoded).toHaveLength(3);
        expect(
          Result.getOrThrow(encodeMultisigState(decoded, round)).toCbor(),
        ).toBe(original.toCbor());
      }),
  );

  it.live.each([
    [23, "b7"],
    [24, "b818"],
  ] as const)(
    "%d signers round-trip through a map with header %s",
    ([count, header]) =>
      Effect.gen(function* () {
        const all = signersOf(count);
        const datum = Result.getOrThrow(encodeMultisigState(all));
        const map = datum.asList()!.get(0).asList()!.get(1).toCbor();
        expect(map.slice(0, header.length)).toBe(header);
        expect(yield* decodeSigners(datum)).toEqual(all);
      }),
  );

  it("a 25-signer redeemer map has the one-byte length header b819", () => {
    expect(
      Result.map(encodeRedeemerMap(signersOf(25)), (map) =>
        map.toCbor().slice(0, 4),
      ),
    ).toEqual(Result.succeed("b819"));
  });

  it.live("a datum that is not exactly a VersionedMultisig is refused", () =>
    Effect.gen(function* () {
      const extra = Result.getOrThrow(
        encodeMultisigState(signersOf(2)),
      ).asList()!;
      extra.add(PlutusData.newInteger(0n));
      for (const datum of [
        PlutusData.newInteger(1n),
        PlutusData.newList(extra),
      ]) {
        const error = yield* Effect.flip(decodeSigners(datum));
        expect(error.reason).toContain("a list of 2 elements");
      }
    }),
  );
});

describe("datumLogicRound", () => {
  it("reads the last element of a multisig or terms datum", () => {
    expect(
      datumLogicRound(Result.getOrThrow(encodeMultisigState(signersOf(2), 1n))),
    ).toEqual(Result.succeed(1));
    expect(
      datumLogicRound(encodeTerms({ hash: "aabb", link: "ccdd" }, 0)),
    ).toEqual(Result.succeed(0));
  });

  it.each([
    ["a non-list datum", PlutusData.newInteger(42n), "not a list with >= 2"],
    [
      "a single-element list",
      list(PlutusData.newInteger(0n)),
      "not a list with >= 2",
    ],
    [
      "a last element that is not an integer",
      list(PlutusData.newInteger(0n), bytes("010203")),
      "last element is not an integer",
    ],
  ])("refuses %s", (_name, datum, reason) => {
    expect(datumLogicRound(datum)).toMatchObject(
      Result.fail({
        _tag: "DatumParseError",
        reason: expect.stringContaining(reason),
      }),
    );
  });

  it.live("terms round-trip", () =>
    Effect.gen(function* () {
      const terms = { hash: "aabb", link: "ccdd" };
      expect(yield* decodeTerms(encodeTerms(terms, 1))).toEqual(terms);
    }),
  );
});

describe("FederatedOps", () => {
  const KEY_IDS = {
    aura: toHex(new TextEncoder().encode("aura")),
    gran: toHex(new TextEncoder().encode("gran")),
    beef: toHex(new TextEncoder().encode("beef")),
    babe: toHex(new TextEncoder().encode("babe")),
  };
  const key = (id: string, value: string) => list(bytes(id), bytes(value));
  const v1 = (...keys: PlutusData[]) =>
    list(
      unit,
      list(list(bytes("aabb"), list(...keys))),
      PlutusData.newInteger(1n),
    );
  const candidate: PermissionedCandidate = {
    sidechain_pub_key: "aabb",
    aura_pub_key: "01",
    grandpa_pub_key: "02",
    beefy_pub_key: "03",
  };

  it("a candidate is [sidechain, [aura, gran, beef]], babe appended when present", () => {
    expect(candidateToPermissionedDatum(candidate)).toEqual([
      "aabb",
      [
        [KEY_IDS.aura, "01"],
        [KEY_IDS.gran, "02"],
        [KEY_IDS.beef, "03"],
      ],
    ]);
    expect(
      candidateToPermissionedDatum({ ...candidate, babe_pub_key: "04" })[1],
    ).toContainEqual([KEY_IDS.babe, "04"]);
  });

  it("decodes aura, gran, beef and babe", () => {
    expect(
      Result.map(
        decodeFederatedOps(
          v1(
            key(KEY_IDS.aura, "01"),
            key(KEY_IDS.gran, "02"),
            key(KEY_IDS.beef, "03"),
            key(KEY_IDS.babe, "04"),
          ),
        ),
        (data) => data.candidates,
      ),
    ).toEqual(Result.succeed([{ ...candidate, babe_pub_key: "04" }]));
  });

  it.each([
    ["v1", undefined],
    ["v2", ""],
  ])("%s encodes and decodes back in its shape", (_shape, message) => {
    const data = {
      data: unit,
      ...(message === undefined ? {} : { message }),
      candidates: [{ ...candidate, babe_pub_key: "04" }],
    };
    expect(decodeFederatedOps(encodeFederatedOps(data))).toEqual(
      Result.succeed(data),
    );
  });

  it.each([
    [
      "a list that is neither v1 nor v2",
      list(unit, PlutusData.newInteger(1n)),
      "3 (v1) or 4 (v2)",
    ],
    ["an unknown key id", v1(key("78787878", "01")), "unknown key id 78787878"],
    [
      "a 3-element key tuple",
      v1(list(bytes(KEY_IDS.aura), bytes("01"), bytes("02"))),
      "expected a 2-element list",
    ],
  ])("refuses %s", (_name, datum, reason) => {
    expect(decodeFederatedOps(datum)).toMatchObject(
      Result.fail({
        _tag: "DatumParseError",
        reason: expect.stringContaining(reason),
      }),
    );
  });
});

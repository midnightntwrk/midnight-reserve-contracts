/**
 * Agreement between the compiled night_registration script and SREF's golden vectors
 * (tests/vectors/staking/night_registration.json): the transaction must pass exactly when the
 * vector expects accept.
 *
 * The compiled script holds its initialization UTxO and is named by its own hash, so the vectors'
 * script hash and initialization transaction id are renamed to the default profile's; the
 * evaluator runs the compiled script for that hash. Any other script the transaction names (a
 * script owner) runs an always-true script.
 */
import { readFileSync } from "node:fs";
import { parse } from "toml";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { action, evaluate, flat, nodeDatum } from "./plutus";
import type { Node, RegistrationConstants, Result, Tx } from "./reference";

const vectors: {
  constants: RegistrationConstants;
  vectors: {
    name: string;
    redeemer: string | null;
    tx: Tx<Node>;
    expected: Result;
  }[];
} = JSON.parse(
  readFileSync(
    new URL("../vectors/staking/night_registration.json", import.meta.url),
    "utf8",
  ),
);
const blueprint = JSON.parse(
  readFileSync(new URL("../../plutus-default.json", import.meta.url), "utf8"),
);
const profile: {
  night_registration_hash: { bytes: string };
  night_registration_one_shot_hash: { bytes: string };
  night_registration_one_shot_index: number;
} = parse(readFileSync(new URL("../../aiken.toml", import.meta.url), "utf8"))
  .config.default;

const k = vectors.constants;
const nightRegistration = flat(
  blueprint,
  "night_registration.night_registration.else",
);
const alwaysTrue = flat(
  blueprint,
  "test_cnight_no_audit.tcnight_mint_infinite.else",
);
const own = profile.night_registration_hash.bytes;
/** The profile's hash for each hash the compiled script holds; any other hash stays. */
const rename = (hex: string) =>
  hex === k.script_hash
    ? own
    : hex === k.init_utxo.tx
      ? profile.night_registration_one_shot_hash.bytes
      : hex;
const script = (hash: string) =>
  hash === own ? nightRegistration : alwaysTrue;

describe("night_registration agrees with the golden vectors", () => {
  it("the default profile's initialization UTxO has the vectors' index", () => {
    expect(profile.night_registration_one_shot_index).toBe(k.init_utxo.index);
  });
  it("the default profile holds the compiled script's hash", () => {
    expect(
      blueprint.validators.find(
        (v: { title: string }) =>
          v.title === "night_registration.night_registration.else",
      ).hash,
    ).toBe(own);
  });
  it.live.each(vectors.vectors)("$name", (v) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        evaluate(
          v.tx,
          nodeDatum,
          rename,
          script,
          action(
            [
              "Init",
              "CreateTwoAnchors",
              "CreateOneAnchor",
              "Update",
              "Deactivate",
            ],
            v.redeemer,
          ),
        ),
      ).pipe(Effect.orElseSucceed(() => null));
      // A script that fails is a rejection; any other error is a fault of this harness.
      if (failure !== null)
        expect(failure).toContain("failed script execution");
      expect(failure === null ? "accept" : "reject").toBe(v.expected.result);
    }),
  );
});

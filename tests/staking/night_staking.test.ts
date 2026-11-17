/**
 * Agreement between the compiled night_staking script and SREF's golden vectors
 * (tests/vectors/staking/night_staking.json): the transaction must pass exactly when the vector
 * expects accept.
 *
 * The evaluator runs the compiled script in place of the vectors' night_staking hash; the script
 * reads its own hash only from its purpose. Any other script the transaction names (a script
 * owner) runs an always-true script. The vectors' cNIGHT policy and night_registration hash are
 * renamed to the default profile's, because the compiled script holds those two hashes. The
 * registration nodes a vector reads are its own reference inputs.
 */
import { readFileSync } from "node:fs";
import { toHex } from "@blaze-cardano/core";
import { parse } from "toml";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { action, evaluate, flat, lockDatum } from "./plutus";
import type { DelegationLock, Result, StakingConstants, Tx } from "./reference";

const vectors: {
  constants: StakingConstants;
  vectors: {
    name: string;
    redeemer: string | null;
    tx: Tx<DelegationLock>;
    expected: Result;
  }[];
} = JSON.parse(
  readFileSync(
    new URL("../vectors/staking/night_staking.json", import.meta.url),
    "utf8",
  ),
);
const blueprint = JSON.parse(
  readFileSync(new URL("../../plutus-default.json", import.meta.url), "utf8"),
);
const profile: {
  cnight_policy: { bytes: string };
  night_registration_hash: { bytes: string };
  cnight_name: string;
  lock_deposit_lovelace: number;
  unbonding_delay_ms: number;
} = parse(readFileSync(new URL("../../aiken.toml", import.meta.url), "utf8"))
  .config.default;

const k = vectors.constants;
const nightStaking = flat(blueprint, "night_staking.night_staking.else");
const alwaysTrue = flat(
  blueprint,
  "test_cnight_no_audit.tcnight_mint_infinite.else",
);
/** The profile's hash for each hash the compiled script holds; any other hash stays. */
const rename = (hash: string) =>
  hash === k.cnight_policy
    ? profile.cnight_policy.bytes
    : hash === k.registration_script_hash
      ? profile.night_registration_hash.bytes
      : hash;
const script = (hash: string) =>
  hash === k.script_hash ? nightStaking : alwaysTrue;

describe("night_staking agrees with the golden vectors", () => {
  it("the default profile has the vectors' constants", () => {
    expect({
      lock_deposit_lovelace: String(profile.lock_deposit_lovelace),
      unbonding_delay_ms: String(profile.unbonding_delay_ms),
      cnight_name: toHex(new TextEncoder().encode(profile.cnight_name)),
    }).toEqual({
      lock_deposit_lovelace: k.lock_deposit_lovelace,
      unbonding_delay_ms: k.unbonding_delay_ms,
      cnight_name: k.cnight_name,
    });
  });
  it.live.each(vectors.vectors)("$name", (v) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        evaluate(
          v.tx,
          lockDatum,
          rename,
          script,
          action(["Lock", "Update", "Unbond", "Unlock"], v.redeemer),
        ),
      ).pipe(Effect.orElseSucceed(() => null));
      // A script that fails is a rejection; any other error is a fault of this harness.
      if (failure !== null)
        expect(failure).toContain("failed script execution");
      expect(failure === null ? "accept" : "reject").toBe(v.expected.result);
    }),
  );
});

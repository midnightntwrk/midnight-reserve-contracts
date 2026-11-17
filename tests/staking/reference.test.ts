import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  checkRegistration,
  checkStaking,
  type DelegationLock,
  type Node,
  type RegistrationConstants,
  type RegistrationRedeemer,
  type Result,
  type StakingConstants,
  type StakingRedeemer,
  type Tx,
} from "./reference";

/** A golden vector file: the per-network constants and the vectors of one contract. */
type Vectors<D, R, K> = {
  contract: string;
  constants: K;
  vectors: {
    name: string;
    source: { line: number | null; text: string };
    /** The action the script's redeemer names; null when the script does not run. */
    redeemer: R | null;
    tx: Tx<D>;
    expected: Result;
  }[];
};
const load = <D, R, K>(contract: string): Vectors<D, R, K> =>
  JSON.parse(
    readFileSync(
      new URL(`../vectors/staking/${contract}.json`, import.meta.url),
      "utf8",
    ),
  );

const staking = load<DelegationLock, StakingRedeemer, StakingConstants>(
  "night_staking",
);
const registration = load<Node, RegistrationRedeemer, RegistrationConstants>(
  "night_registration",
);

describe("night_staking reference", () => {
  test.each(staking.vectors.map((v) => [v.name, v] as const))("%s", (_, v) => {
    expect(checkStaking(v.tx, v.redeemer, staking.constants)).toEqual(
      v.expected,
    );
  });
});

describe("night_registration reference", () => {
  test.each(registration.vectors.map((v) => [v.name, v] as const))(
    "%s",
    (_, v) => {
      expect(
        checkRegistration(v.tx, v.redeemer, registration.constants),
      ).toEqual(v.expected);
    },
  );
});

/**
 * The reference compares bytes as hex strings, so the vectors must spell every byte string one
 * way, in lowercase. Every string in a transaction or the constants is hex, a decimal amount or a
 * certificate kind, so none may hold an uppercase letter.
 */
test("every byte string in the vectors is lowercase hex", () => {
  const strings = (x: unknown): string[] =>
    typeof x === "string"
      ? [x]
      : x !== null && typeof x === "object"
        ? Object.values(x).flatMap(strings)
        : [];
  const all = [staking, registration].flatMap((file) => [
    ...strings(file.constants),
    ...file.vectors.flatMap((v) => strings(v.tx)),
  ]);
  expect(all.filter((s) => /[A-Z]/.test(s))).toEqual([]);
});

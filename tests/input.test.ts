import { describe, expect, test } from "bun:test";
import {
  CredentialType,
  Hash28ByteBase16,
  NetworkId,
  RewardAccount,
} from "@blaze-cardano/core";
import { Either } from "effect";
import {
  parseKeyAddress,
  parseNameList,
  parsePositiveBigInt,
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseScriptHash,
  parseTxHash,
} from "../cli/input";
import { credentialAddress } from "../cli/contracts/contracts";
import { keyAddress } from "./helpers/fixtures";

const HASH_PARSERS: [
  string,
  (text: string) => Either.Either<string, string>,
  number,
][] = [
  ["parseTxHash", parseTxHash, 64],
  ["parseScriptHash", parseScriptHash, 56],
];

describe("hash parsers", () => {
  test.each(HASH_PARSERS)(
    "%s takes exactly %i hex characters, lower-cased",
    (_, parse, length) => {
      const hex = "aB".repeat(length / 2);
      expect(parse(hex)).toEqual(Either.right("ab".repeat(length / 2)));
      expect(parse("ab")).toEqual(
        Either.left(`'ab' must be ${length} hex characters`),
      );
      expect(parse(hex + "ab")).toEqual(
        Either.left(`'${hex}ab' must be ${length} hex characters`),
      );
      const bad = "zz".repeat(length / 2);
      expect(parse(bad)).toEqual(
        Either.left(`'${bad}' must contain only hex characters`),
      );
    },
  );
});

describe("integer parsers", () => {
  test("accept base-10 digits only, from their minimum", () => {
    expect(parsePositiveInteger("16")).toEqual(Either.right(16));
    expect(parseNonNegativeInteger("0")).toEqual(Either.right(0));
    expect(parsePositiveInteger("0")).toEqual(
      Either.left("'0' is not a positive base-10 integer"),
    );
  });

  test.each(["-1", "1.5", "abc", "1e3", "", " 1", "9007199254740992"])(
    "parseNonNegativeInteger rejects '%s'",
    (text) => {
      expect(parseNonNegativeInteger(text)).toEqual(
        Either.left(`'${text}' is not a non-negative base-10 integer`),
      );
    },
  );

  test.each(["abc", "0", "-1", "2.5", "1e3"])(
    "parsePositiveInteger (--count) rejects '%s'",
    (text) => {
      expect(parsePositiveInteger(text)).toEqual(
        Either.left(`'${text}' is not a positive base-10 integer`),
      );
    },
  );
});

describe("parsePositiveBigInt (--amount)", () => {
  test("takes a positive integer", () => {
    expect(parsePositiveBigInt("5000000")).toEqual(Either.right(5_000_000n));
  });

  test.each(["ten", "0", "-5", "0x10", " 5", "2.5", ""])(
    "rejects '%s'",
    (text) => {
      expect(parsePositiveBigInt(text)).toEqual(
        Either.left(`'${text}' is not a positive base-10 integer`),
      );
    },
  );
});

describe("parseKeyAddress (simple-tx --to)", () => {
  test("takes an address that pays a key", () => {
    const text = keyAddress("ab".repeat(28)).toBech32();
    expect(
      Either.map(parseKeyAddress(text), (address) => address.toBech32()),
    ).toEqual(Either.right(text));
  });

  test("refuses an address that pays a script", () => {
    const text = credentialAddress(
      NetworkId.Testnet,
      "ab".repeat(28),
    ).toBech32();
    expect(parseKeyAddress(text)).toEqual(
      Either.left(`'${text}' is a script address; a key address is required`),
    );
  });

  test.each([
    ["key", CredentialType.KeyHash, "stake_test1u"],
    ["script", CredentialType.ScriptHash, "stake_test17"],
  ])("refuses a %s reward address", (_name, type, prefix) => {
    const text = RewardAccount.fromCredential(
      { type, hash: Hash28ByteBase16("ab".repeat(28)) },
      NetworkId.Testnet,
    );
    expect(text.startsWith(prefix)).toBe(true);
    expect(parseKeyAddress(text)).toEqual(
      Either.left(
        `'${text}' is a reward (stake) address; a payment key address is required`,
      ),
    );
  });
});

describe("parseNameList (--components)", () => {
  const parse = parseNameList(["reserve", "ics"] as const);

  test("keeps the given names, blanks and spaces dropped", () => {
    expect(parse(" ics, ,reserve ")).toEqual(Either.right(["ics", "reserve"]));
  });

  test.each(["", " , ,"])("an empty list %p is refused", (text) => {
    expect(parse(text)).toEqual(
      Either.left("no name given; valid: reserve, ics"),
    );
  });

  test("unknown names are refused, with the valid ones; all is not a name", () => {
    expect(parse("reserve,foo,all")).toEqual(
      Either.left("unknown: foo, all; valid: reserve, ics"),
    );
  });
});

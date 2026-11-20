import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  decodeJson,
  parseNonNegativeInteger,
  parseTxHash,
  parseTxIndex,
} from "../cli/input";

describe("parseTxHash", () => {
  it("takes exactly 64 hex characters, lower-cased", () => {
    const hex = "aB".repeat(32);
    expect(parseTxHash(hex)).toEqual(Result.succeed("ab".repeat(32)));
    expect(parseTxHash("ab")).toEqual(
      Result.fail("'ab' must be 64 hex characters"),
    );
    expect(parseTxHash(hex + "ab")).toEqual(
      Result.fail(`'${hex}ab' must be 64 hex characters`),
    );
    const bad = "zz".repeat(32);
    expect(parseTxHash(bad)).toEqual(
      Result.fail(`'${bad}' must contain only hex characters`),
    );
  });
});

describe("parseNonNegativeInteger (aiken.toml indexes)", () => {
  it("takes base-10 digits from 0", () => {
    expect(parseNonNegativeInteger("0")).toEqual(Result.succeed(0));
    expect(parseTxIndex("16")).toEqual(Result.succeed(16));
  });

  it.each(["-1", "1.5", "abc", "1e3", "", " 1", "9007199254740992"])(
    "rejects '%s'",
    (text) => {
      expect(parseNonNegativeInteger(text)).toEqual(
        Result.fail(`'${text}' is not a non-negative base-10 integer`),
      );
    },
  );
});

describe("decodeJson", () => {
  const decode = decodeJson(Schema.Struct({ title: Schema.String }));

  it("decodes JSON text through the schema", () => {
    expect(decode('{"title":"t","extra":1}')).toEqual(
      Result.succeed({ title: "t" }),
    );
  });

  it("names the field that does not match, and refuses text that is not JSON", () => {
    expect(Result.getOrThrow(Result.flip(decode('{"title":1}')))).toContain(
      '["title"]',
    );
    expect(Result.isFailure(decode("{"))).toBe(true);
  });
});

/**
 * Parsers of external input: argument, file and environment text, and JSON
 * files decoded through a schema. A plain parser's failure is the reason;
 * the signer and candidate parsers fail with an InputParseError naming the
 * variable. Commands parse their flags through them at the boundary, the
 * configuration its aiken.toml and environment values.
 */
import { Address, AddressType, CredentialType } from "@blaze-cardano/core";
import {
  Array as Arr,
  Brand,
  Effect,
  FileSystem,
  Result,
  Schema,
} from "effect";
import { resolve } from "path";
import { InputParseError } from "./errors";

/** A 32-byte transaction id as 64 lower-case hex characters. */
export type TxHash = string & Brand.Brand<"TxHash">;
/** A transaction output index. */
export type TxIndex = number & Brand.Brand<"TxIndex">;
/** A 32-byte hash as 64 lower-case hex characters. */
export type Hash32 = string & Brand.Brand<"Hash32">;

const HEX = /^[a-fA-F0-9]+$/;

/** Hex of the given length, lower-cased: the chain and the blueprint compare hashes in lower case. */
const hexOfLength =
  (length: number) =>
  (value: string): Result.Result<string, string> =>
    value.length !== length
      ? Result.fail(`'${value}' must be ${length} hex characters`)
      : HEX.test(value)
        ? Result.succeed(value.toLowerCase())
        : Result.fail(`'${value}' must contain only hex characters`);

/** A transaction id from its hex. */
export const parseTxHash = (value: string): Result.Result<TxHash, string> =>
  Result.map(hexOfLength(64)(value), Brand.nominal<TxHash>());

/** A 32-byte hash from its hex. */
export const parseHash32 = (value: string): Result.Result<Hash32, string> =>
  Result.map(hexOfLength(64)(value), Brand.nominal<Hash32>());

/** The all-zero 32-byte hash: the terms-and-conditions hash before a document is set. */
export const ZERO_HASH32 = Brand.nominal<Hash32>()("00".repeat(32));

const DECIMAL = /^[0-9]+$/;

/** A non-negative safe integer from its base-10 text. */
export const parseNonNegativeInteger = (
  text: string,
): Result.Result<number, string> => {
  const value = DECIMAL.test(text) ? Number(text) : Number.NaN;
  return Number.isSafeInteger(value)
    ? Result.succeed(value)
    : Result.fail(`'${text}' is not a non-negative base-10 integer`);
};

/** A positive safe integer from its base-10 text. */
export const parsePositiveInteger = (
  text: string,
): Result.Result<number, string> =>
  Result.filterOrFail(
    parseNonNegativeInteger(text),
    (value) => value >= 1,
    () => `'${text}' is not a positive base-10 integer`,
  );

/** A positive amount (lovelace, tokens) from its base-10 text. */
export const parsePositiveBigInt = (
  text: string,
): Result.Result<bigint, string> =>
  DECIMAL.test(text) && BigInt(text) > 0n
    ? Result.succeed(BigInt(text))
    : Result.fail(`'${text}' is not a positive base-10 integer`);

/** A bech32 address; the failure is the reason. */
export const parseBech32Address = (
  text: string,
): Effect.Effect<Address, string> =>
  Effect.try({
    try: () => Address.fromBech32(text),
    catch: (cause) =>
      `'${text}' is not a bech32 address: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/** A payment key address: neither a script address nor a reward address; the failure is the reason. */
export const parseKeyAddress = (text: string): Effect.Effect<Address, string> =>
  Effect.flatMap(parseBech32Address(text), (address) =>
    address.getType() === AddressType.RewardKey ||
    address.getType() === AddressType.RewardScript
      ? Effect.fail(
          `'${text}' is a reward (stake) address; a payment key address is required`,
        )
      : address.getProps().paymentPart?.type === CredentialType.KeyHash
        ? Effect.succeed(address)
        : Effect.fail(
            `'${text}' is a script address; a key address is required`,
          ),
  );

/** A transaction output index from its base-10 text. */
export const parseTxIndex = (text: string): Result.Result<TxIndex, string> =>
  Result.map(parseNonNegativeInteger(text), Brand.nominal<TxIndex>());

/** Comma-separated names, each one of `valid`, blanks dropped; at least one. */
export const parseNameList =
  <A extends string>(valid: readonly A[]) =>
  (text: string): Result.Result<Arr.NonEmptyReadonlyArray<A>, string> => {
    const names = text
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    const isValid = (name: string): name is A => valid.some((v) => v === name);
    const known = names.filter(isValid);
    const unknown = names.filter((name) => !isValid(name));
    return unknown.length > 0
      ? Result.fail(
          `unknown: ${unknown.join(", ")}; valid: ${valid.join(", ")}`,
        )
      : Arr.isReadonlyArrayNonEmpty(known)
        ? Result.succeed(known)
        : Result.fail(`no name given; valid: ${valid.join(", ")}`);
  };

/** A council or tech-auth member: payment key hash and sr25519 key, both lower-case hex. */
export interface Signer {
  readonly paymentHash: string;
  readonly sr25519Key: string;
}

/** At least one signer. */
export type Signers = Arr.NonEmptyReadonlyArray<Signer>;

/**
 * The signers in `value`, "hash:key,hash:key". An empty entry is refused (a
 * stray comma would drop a member); a duplicate is kept, as it counts twice
 * on chain.
 */
export const parseSigners = (
  source: string,
  value: string,
): Result.Result<Signers, InputParseError> => {
  const fail = (issue: string) =>
    Result.fail(new InputParseError({ source, issues: [issue] }));
  return Result.flatMap(
    Result.all(
      value.split(",").map((text, index) => {
        const entry = text.trim();
        const fields = entry.split(":").map((field) => field.trim());
        const [paymentHash = "", sr25519Key = ""] = fields;
        return entry === ""
          ? fail(`signer entry at position ${index + 1} is empty`)
          : fields.length !== 2
            ? fail(
                `signer entry '${entry}' must contain exactly one ':' delimiter`,
              )
            : paymentHash === "" || sr25519Key === ""
              ? fail(
                  `signer entry '${entry}' must include non-empty payment hash and sr25519 key`,
                )
              : paymentHash.length !== 56 || !HEX.test(paymentHash)
                ? fail(
                    `payment hash must be 56 hex characters (28 bytes), got '${paymentHash}'`,
                  )
                : !HEX.test(sr25519Key)
                  ? fail(`sr25519 key must be valid hex, got '${sr25519Key}'`)
                  : Result.succeed({
                      paymentHash: paymentHash.toLowerCase(),
                      sr25519Key: sr25519Key.toLowerCase(),
                    });
      }),
    ),
    (signers) =>
      Arr.isReadonlyArrayNonEmpty(signers)
        ? Result.succeed(signers)
        : fail("no signer entries"),
  );
};

/** A permissioned candidate of the federated operators: its sidechain key and session keys, as hex. */
export interface PermissionedCandidate {
  readonly sidechain_pub_key: string;
  readonly aura_pub_key: string;
  readonly grandpa_pub_key: string;
  readonly beefy_pub_key: string;
  readonly babe_pub_key?: string;
}

const CANDIDATE_FIELDS = [
  "sidechain_pub_key",
  "aura_pub_key",
  "grandpa_pub_key",
  "beefy_pub_key",
] as const;

/**
 * The candidates in PERMISSIONED_CANDIDATES:
 * `[ { sidechain_pub_key: ..., aura_pub_key: ..., grandpa_pub_key: ..., beefy_pub_key: ... }, ... ]`,
 * entries separated by commas or new lines, babe_pub_key optional. An entry
 * without ':' is refused.
 */
export const parseCandidates = (
  input: string,
): Result.Result<PermissionedCandidate[], InputParseError> => {
  const fail = (issue: string) =>
    Result.fail(
      new InputParseError({
        source: "PERMISSIONED_CANDIDATES",
        issues: [issue],
      }),
    );
  const trimmed = input.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return fail("expected input to be wrapped in [ ]");
  }
  const content = trimmed.slice(1, -1).trim();
  // The inner text of each top-level `{ ... }` block.
  const blocks: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of content) {
    if (char === "{" && ++depth === 1) {
      current = "";
    } else if (char === "}" && --depth === 0) {
      blocks.push(current.trim());
    } else if (depth > 0) {
      current += char;
    }
  }
  if (depth !== 0) return fail(`unbalanced braces (depth=${depth})`);
  const nonEmpty = blocks.filter((block) => block.length > 0);
  if (content.length > 0 && nonEmpty.length === 0) {
    return fail(
      "non-empty input yielded zero candidate blocks; check for malformed braces",
    );
  }
  return Result.all(
    nonEmpty.map((block, index) => {
      const fields: Record<string, string> = {};
      for (const line of block.split(/[,\n]/)) {
        if (line.trim() === "") continue;
        const colon = line.indexOf(":");
        if (colon === -1) {
          return fail(
            `candidate at index ${index} has an entry without ':': ${line.trim()}`,
          );
        }
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (key && value) fields[key] = value;
      }
      for (const field of [...CANDIDATE_FIELDS, "babe_pub_key"]) {
        const value = fields[field];
        if (value === undefined && field !== "babe_pub_key") {
          return fail(
            `candidate at index ${index} is missing required field: ${field}`,
          );
        }
        if (value !== undefined && !HEX.test(value)) {
          return fail(
            `candidate at index ${index} has invalid hex value for ${field}: ${value}`,
          );
        }
      }
      const candidate: PermissionedCandidate = {
        sidechain_pub_key: fields.sidechain_pub_key,
        aura_pub_key: fields.aura_pub_key,
        grandpa_pub_key: fields.grandpa_pub_key,
        beefy_pub_key: fields.beefy_pub_key,
      };
      return Result.succeed(
        fields.babe_pub_key
          ? { ...candidate, babe_pub_key: fields.babe_pub_key }
          : candidate,
      );
    }),
  );
};

/** Decode JSON text through a schema; the failure is the schema's issue message. */
export const decodeJson = <A>(schema: Schema.Decoder<A>) => {
  const decode = Schema.decodeUnknownResult(Schema.fromJsonString(schema));
  return (text: string): Result.Result<A, string> =>
    Result.mapError(decode(text), (error) => error.message);
};

/** Read and decode a JSON file; a read or decode failure reaches `onError` as its reason. */
export const readJsonFile = <A, E>(
  path: string,
  schema: Schema.Decoder<A>,
  onError: (reason: string) => E,
): Effect.Effect<A, E, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* Effect.mapError(fs.readFileString(path), (cause) =>
      onError(cause.message),
    );
    return yield* Effect.fromResult(
      Result.mapError(decodeJson(schema)(text), onError),
    );
  });

/** The path a transaction command writes: `<outputDir>/<network>/<outputFile>`. */
export const txFilePath = (input: {
  readonly outputDir: string;
  readonly network: string;
  readonly outputFile: string;
}): string => resolve(input.outputDir, input.network, input.outputFile);

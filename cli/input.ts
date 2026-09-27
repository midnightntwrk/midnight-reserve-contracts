/**
 * Parsers of external input: argument and env text (Left is the reason; the
 * options parse arguments through them at the boundary, Settings its env
 * values), the input records the programs share, and JSON files decoded
 * through a schema.
 */
import { resolve } from "path";
import {
  Address,
  AddressType,
  CredentialType,
  NetworkId,
} from "@blaze-cardano/core";
import { FileSystem } from "@effect/platform";
import {
  Array as Arr,
  Brand,
  Effect,
  Either,
  ParseResult,
  Schema,
} from "effect";
import { type Environment, environmentOf } from "./config/network-mapping";
import { describeCause } from "./errors";

/** A 32-byte transaction id as 64 lower-case hex characters. */
export type TxHash = string & Brand.Brand<"TxHash">;
/** A 32-byte hash as 64 lower-case hex characters. */
export type Hash32 = string & Brand.Brand<"Hash32">;
/** A 28-byte script hash as 56 lower-case hex characters. */
export type ScriptHash = string & Brand.Brand<"ScriptHash">;
/** A transaction output index. */
export type TxIndex = number & Brand.Brand<"TxIndex">;
/** An address whose payment credential is a key hash. */
export type KeyAddress = Address & Brand.Brand<"KeyAddress">;

const HEX = /^[a-fA-F0-9]+$/;

/** Hex of this length, lower-cased: the chain and the blueprint compare hashes in lower case. */
const hexOfLength =
  (length: number) =>
  (value: string): Either.Either<string, string> =>
    value.length !== length
      ? Either.left(`'${value}' must be ${length} hex characters`)
      : HEX.test(value)
        ? Either.right(value.toLowerCase())
        : Either.left(`'${value}' must contain only hex characters`);

/** A transaction id from its hex; Left is the reason. */
export const parseTxHash = (value: string): Either.Either<TxHash, string> =>
  Either.map(hexOfLength(64)(value), Brand.nominal<TxHash>());

/** A 32-byte hash from its hex; Left is the reason. */
export const parseHash32 = (value: string): Either.Either<Hash32, string> =>
  Either.map(hexOfLength(64)(value), Brand.nominal<Hash32>());

/** The all-zero 32-byte hash: the terms-and-conditions hash before a document is set. */
export const ZERO_HASH32 = Brand.nominal<Hash32>()("00".repeat(32));

/** A script hash from its hex; Left is the reason. */
export const parseScriptHash = (
  value: string,
): Either.Either<ScriptHash, string> =>
  Either.map(hexOfLength(56)(value), Brand.nominal<ScriptHash>());

/** A Midnight node's JSON-RPC endpoint: an http or https URL; Left is the reason. */
export const parseRpcUrl = (value: string): Either.Either<string, string> =>
  /^https?:\/\/[^\s/]+/.test(value)
    ? Either.right(value)
    : Either.left(`'${value}' must be an http:// or https:// URL`);

/** A command's environment. */
export interface NetworkInput {
  readonly network: Environment;
}

/** The report formats, as --format takes them. */
export const FORMATS = ["json", "table"] as const;

export type Format = (typeof FORMATS)[number];

/** Where a transaction command writes its file: <outputDir>/<network>/<outputFile>. */
export interface TxFileInput extends NetworkInput {
  readonly outputDir: string;
  readonly outputFile: string;
}

/** The path a transaction command writes. */
export const txFilePath = (input: TxFileInput): string =>
  resolve(input.outputDir, input.network, input.outputFile);

/** The deployer UTxO that pays the fee, and the fee padding in lovelace. */
export interface FeeInput {
  readonly txHash: TxHash;
  readonly txIndex: TxIndex;
  readonly feePadding: bigint;
}

const DECIMAL = /^[0-9]+$/;

const safeIntegerFrom =
  (min: number, what: string) =>
  (text: string): Either.Either<number, string> => {
    const value = DECIMAL.test(text) ? Number(text) : Number.NaN;
    return Number.isSafeInteger(value) && value >= min
      ? Either.right(value)
      : Either.left(`'${text}' is not a ${what} base-10 integer`);
  };

/** A positive safe integer from its base-10 text; Left is the reason. */
export const parsePositiveInteger = safeIntegerFrom(1, "positive");

/** A non-negative safe integer from its base-10 text; Left is the reason. */
export const parseNonNegativeInteger = safeIntegerFrom(0, "non-negative");

/** A transaction output index from its base-10 text; Left is the reason. */
export const parseTxIndex = (text: string): Either.Either<TxIndex, string> =>
  Either.map(parseNonNegativeInteger(text), Brand.nominal<TxIndex>());

/** Whether `value` is one of `valid`. */
const isOneOf =
  <A extends string>(valid: readonly A[]) =>
  (value: string): value is A =>
    valid.some((name) => name === value);

/** A non-empty comma-separated list of names from `valid`, blanks dropped; Left is the reason. */
export const parseNameList =
  <A extends string>(valid: readonly A[]) =>
  (text: string): Either.Either<Arr.NonEmptyReadonlyArray<A>, string> => {
    const names = text
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    const unknown = names.filter((name) => !isOneOf(valid)(name));
    const known = names.filter(isOneOf(valid));
    return unknown.length > 0
      ? Either.left(
          `unknown: ${unknown.join(", ")}; valid: ${valid.join(", ")}`,
        )
      : Arr.isNonEmptyReadonlyArray(known)
        ? Either.right(known)
        : Either.left(`no name given; valid: ${valid.join(", ")}`);
  };

/** A bech32 address; Left is the reason. */
export const parseBech32Address = (
  text: string,
): Either.Either<Address, string> =>
  Either.mapLeft(
    Either.try(() => Address.fromBech32(text)),
    (cause) => `'${text}' is not a bech32 address: ${describeCause(cause)}`,
  );

const REWARD_ADDRESSES: ReadonlySet<AddressType> = new Set([
  AddressType.RewardKey,
  AddressType.RewardScript,
]);

/** A bech32 payment address that pays a key, not a script or a reward account; Left is the reason. */
export const parseKeyAddress = (
  text: string,
): Either.Either<KeyAddress, string> =>
  Either.flatMap(parseBech32Address(text), (address) =>
    REWARD_ADDRESSES.has(address.getType())
      ? Either.left(
          `'${text}' is a reward (stake) address; a payment key address is required`,
        )
      : address.getProps().paymentPart?.type === CredentialType.KeyHash
        ? Either.right(Brand.nominal<KeyAddress>()(address))
        : Either.left(
            `'${text}' is a script address; a key address is required`,
          ),
  );

/** The address when it is on the environment's network; Left is the reason. */
export const addressOn = (
  address: Address,
  environment: Environment,
): Either.Either<Address, string> => {
  const { networkId } = environmentOf(environment);
  return address.getNetworkId() === networkId
    ? Either.right(address)
    : Either.left(
        `'${address.toBech32()}' is a ${NetworkId[address.getNetworkId()]} address; ${environment} is on ${NetworkId[networkId]}`,
      );
};

/** A bech32 address on the environment's network; Left is the reason. */
export const parseAddressOn = (
  text: string,
  environment: Environment,
): Either.Either<Address, string> =>
  Either.flatMap(parseBech32Address(text), (address) =>
    addressOn(address, environment),
  );

/** A positive amount (lovelace, tokens) from its base-10 text; Left is the reason. */
export const parsePositiveBigInt = (
  text: string,
): Either.Either<bigint, string> =>
  DECIMAL.test(text) && BigInt(text) > 0n
    ? Either.right(BigInt(text))
    : Either.left(`'${text}' is not a positive base-10 integer`);

/** Decode JSON text through a schema, keeping the original field order; the failure is the TreeFormatter message. */
export const decodeJson = <A, I>(schema: Schema.Schema<A, I>) => {
  const decode = Schema.decodeEither(Schema.parseJson(schema));
  return (text: string): Either.Either<A, string> =>
    Either.mapLeft(
      decode(text, { propertyOrder: "original" }),
      ParseResult.TreeFormatter.formatErrorSync,
    );
};

/** Read and decode a JSON file; a read or decode failure reaches `onError` as its reason. */
export const readJsonFile = <A, I, E>(
  path: string,
  schema: Schema.Schema<A, I>,
  onError: (reason: string) => E,
): Effect.Effect<A, E, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.flatMap(
      Effect.mapError(fs.readFileString(path), (cause) =>
        onError(cause.message),
      ),
      (text) => Either.mapLeft(decodeJson(schema)(text), onError),
    ),
  );

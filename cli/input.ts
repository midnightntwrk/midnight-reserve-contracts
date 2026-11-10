/**
 * Parsers of external input: argument and file text (a failure is the
 * reason; commands parse their flags through them at the boundary, the
 * configuration its aiken.toml values), and JSON files decoded through a
 * schema.
 */
import { Brand, Effect, FileSystem, Result, Schema } from "effect";

/** A 32-byte transaction id as 64 lower-case hex characters. */
export type TxHash = string & Brand.Brand<"TxHash">;
/** A transaction output index. */
export type TxIndex = number & Brand.Brand<"TxIndex">;

const HEX = /^[a-fA-F0-9]+$/;

/** A transaction id from its hex, lower-cased: the chain and the blueprint compare hashes in lower case. */
export const parseTxHash = (value: string): Result.Result<TxHash, string> =>
  value.length !== 64
    ? Result.fail(`'${value}' must be 64 hex characters`)
    : HEX.test(value)
      ? Result.succeed(Brand.nominal<TxHash>()(value.toLowerCase()))
      : Result.fail(`'${value}' must contain only hex characters`);

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

/** A transaction output index from its base-10 text. */
export const parseTxIndex = (text: string): Result.Result<TxIndex, string> =>
  Result.map(parseNonNegativeInteger(text), Brand.nominal<TxIndex>());

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

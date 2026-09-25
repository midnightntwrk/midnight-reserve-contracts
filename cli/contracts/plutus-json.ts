/**
 * Schemas of the deployed-scripts files: plutus.json, versions.json and
 * changelog.json. A plutus.json keeps every field it was read with, in the
 * original order, so a merged snapshot writes back what it read.
 */
import { Schema } from "effect";

const Rest = Schema.Record({ key: Schema.String, value: Schema.Unknown });

/** One validator of a plutus.json. */
export const PlutusValidator = Schema.Struct(
  { title: Schema.String, hash: Schema.String, compiledCode: Schema.String },
  Rest,
).annotations({ identifier: "PlutusValidator" });
export type PlutusValidator = typeof PlutusValidator.Type;

/** A plutus.json blueprint; `definitions` holds the types its validators' schemas reference. */
export const PlutusJson = Schema.Struct(
  {
    validators: Schema.Array(PlutusValidator),
    definitions: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  },
  Rest,
).annotations({ identifier: "PlutusJson" });
export type PlutusJson = typeof PlutusJson.Type;

/** Promoted and staged validator names of an environment. */
export const VersionsJson = Schema.Struct({
  promoted: Schema.Array(Schema.String),
  staged: Schema.Array(Schema.String),
}).annotations({ identifier: "VersionsJson" });
export type VersionsJson = typeof VersionsJson.Type;

/** One entry of a changelog.json. */
export const ChangeRecord = Schema.Struct({
  type: Schema.Literal("initial", "stage", "promote"),
  validator: Schema.String,
  oldHash: Schema.optional(Schema.String),
  newHash: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  /** When the change was recorded; absent in records written before 2026-09-26. */
  timestamp: Schema.optional(Schema.String),
}).annotations({ identifier: "ChangeRecord" });
export type ChangeRecord = typeof ChangeRecord.Type;

/** The changelog.json of a deployment snapshot: when it started, its records in order; `gitCommit` is only in files started before 2026-09-26. */
export const Changelog = Schema.Struct({
  timestamp: Schema.String,
  gitCommit: Schema.optional(Schema.String),
  changes: Schema.Array(ChangeRecord),
}).annotations({ identifier: "Changelog" });
export type Changelog = typeof Changelog.Type;

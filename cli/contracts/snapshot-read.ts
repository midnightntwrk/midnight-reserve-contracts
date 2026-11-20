/**
 * The deployed-scripts record, read: the schemas of its files (plutus.json,
 * versions.json, changelog.json) and the reads the build and
 * ContractResolver make of it. Nothing here writes, and every failure is a
 * BlueprintError.
 */
import { resolve } from "path";
import { Effect, FileSystem, Option, Result, Schema } from "effect";
import { DeployedScripts } from "../config";
import { BlueprintError } from "../errors";
import { readJsonFile } from "../input";

/** The four files of an environment's record. */
export const filesOf = (env: string) =>
  Effect.map(DeployedScripts, ({ root }) => {
    const dir = resolve(root, env);
    return {
      dir,
      plutus: resolve(dir, "plutus.json"),
      blueprint: resolve(dir, "contract_blueprint.ts"),
      versions: resolve(dir, "versions.json"),
      changelog: resolve(dir, "changelog.json"),
    };
  });

const Rest = [Schema.Record(Schema.String, Schema.Unknown)] as const;

/** One validator of a plutus.json; its other fields (datum, redeemer, …) are kept. */
export const PlutusValidator = Schema.StructWithRest(
  Schema.Struct({
    title: Schema.String,
    hash: Schema.String,
    compiledCode: Schema.String,
  }),
  Rest,
);
export type PlutusValidator = typeof PlutusValidator.Type;

/** A plutus.json blueprint; `definitions` holds the types its validators' schemas reference. */
export const PlutusJson = Schema.StructWithRest(
  Schema.Struct({
    validators: Schema.Array(PlutusValidator),
    definitions: Schema.Record(Schema.String, Schema.Unknown),
  }),
  Rest,
);
export type PlutusJson = typeof PlutusJson.Type;

/** The promoted and staged validator names of an environment. */
export const VersionsJson = Schema.Struct({
  promoted: Schema.Array(Schema.String),
  staged: Schema.Array(Schema.String),
});
export type VersionsJson = typeof VersionsJson.Type;

/** One entry of a changelog.json. */
const ChangeRecord = Schema.Struct({
  type: Schema.Literals(["initial", "stage", "promote"]),
  validator: Schema.String,
  oldHash: Schema.optionalKey(Schema.String),
  newHash: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  /** When the change was recorded; absent in records written before 2026-09-26. */
  timestamp: Schema.optionalKey(Schema.String),
});
export type ChangeRecord = typeof ChangeRecord.Type;

/** The changelog.json of a record: when it started and its changes in order; `gitCommit` is only in files started before 2026-09-26. */
export const Changelog = Schema.Struct({
  timestamp: Schema.String,
  gitCommit: Schema.optionalKey(Schema.String),
  changes: Schema.Array(ChangeRecord),
});
export type Changelog = typeof Changelog.Type;

/** "module.name.else" is "name": the module prefix and a trailing else or spend are dropped. */
export const validatorName = (title: string): string => {
  const parts = title.split(".");
  const last = parts[parts.length - 1];
  return (
    last === "else" || last === "spend" ? parts.slice(1, -1) : parts.slice(1)
  ).join(".");
};

/** The distinct names of these validators, in order. */
export const namesOf = (validators: readonly PlutusValidator[]): string[] => [
  ...new Set(validators.map((v) => validatorName(v.title))),
];

/**
 * A record or build file through its schema; None when the file does not
 * exist. A plutus.json is the parsed JSON itself once the schema accepts
 * it, so its keys keep their order and a write gives back what it read.
 */
export const readFile = <A>(
  env: string,
  source: "deployed" | "build",
  path: string,
  schema: Schema.Decoder<A>,
): Effect.Effect<Option.Option<A>, BlueprintError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const failure = (reason: string) =>
      new BlueprintError({ environment: env, source, reason });
    if (!(yield* Effect.mapError(fs.exists(path), (e) => failure(e.message)))) {
      return Option.none();
    }
    const raw = yield* readJsonFile(path, Schema.Unknown, (reason) =>
      failure(`${path}: ${reason}`),
    );
    return Schema.is(schema)(raw)
      ? Option.some(raw)
      : yield* failure(
          `${path}: ${Result.match(Schema.decodeUnknownResult(schema)(raw), {
            onFailure: (error) => error.message,
            onSuccess: () => "does not match its schema",
          })}`,
        );
  });

/** versions.json of an environment; None when it does not exist. */
export const readVersions = (env: string) =>
  Effect.flatMap(filesOf(env), (files) =>
    readFile(env, "deployed", files.versions, VersionsJson),
  );

/** The deployed plutus.json of an environment and its path; a missing file is a BlueprintError. */
export const readDeployedPlutus = (env: string) =>
  Effect.gen(function* () {
    const { plutus: path } = yield* filesOf(env);
    const plutus = yield* readFile(env, "deployed", path, PlutusJson);
    return Option.isSome(plutus)
      ? { path, plutus: plutus.value }
      : yield* new BlueprintError({
          environment: env,
          source: "deployed",
          reason: `${path} does not exist`,
        });
  });

/** The deployed record of an environment: each plutus.json validator with its name, and versions.json; a missing file is a BlueprintError. */
export const readRecord = (env: string) =>
  Effect.gen(function* () {
    const { plutus } = yield* readDeployedPlutus(env);
    const files = yield* filesOf(env);
    const versions = yield* readVersions(env);
    if (Option.isNone(versions)) {
      return yield* new BlueprintError({
        environment: env,
        source: "deployed",
        reason: `${files.versions} does not exist`,
      });
    }
    return {
      validators: plutus.validators.map(({ title, hash, compiledCode }) => ({
        name: validatorName(title),
        hash,
        compiledCode,
      })),
      versions: versions.value,
    };
  });

/** The build plutus.json at `plutusPath`; a missing file names the build to run. */
export const readBuildPlutus = (env: string, plutusPath: string) =>
  Effect.flatMap(
    readFile(env, "build", plutusPath, PlutusJson),
    Option.match({
      onNone: () =>
        Effect.fail(
          new BlueprintError({
            environment: env,
            source: "build",
            reason: `build plutus.json not found at ${plutusPath}. Run 'just build' first.`,
          }),
        ),
      onSome: Effect.succeed,
    }),
  );

/** The build validators with these hashes; a hash the build lacks is an error, so no deployed validator goes unrecorded. */
export const deployedAmong = (
  env: string,
  plutusPath: string,
  build: PlutusJson,
  hashes: ReadonlySet<string>,
): Result.Result<PlutusValidator[], BlueprintError> => {
  const known = new Set(build.validators.map((v) => v.hash));
  const missing = [...hashes].filter((hash) => !known.has(hash));
  return missing.length > 0
    ? Result.fail(
        new BlueprintError({
          environment: env,
          source: "build",
          reason: `the build lacks the validators with hashes ${missing.join(", ")}; the blueprint and ${plutusPath} are from different builds`,
        }),
      )
    : Result.succeed(build.validators.filter((v) => hashes.has(v.hash)));
};

/** The definition keys a schema references directly ("#/definitions/a~1b" is "a/b"). */
const refsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(refsOf)
    : typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([key, inner]) =>
          key === "$ref" && typeof inner === "string"
            ? [
                inner
                  .replace("#/definitions/", "")
                  .replace(/~1/g, "/")
                  .replace(/~0/g, "~"),
              ]
            : refsOf(inner),
        )
      : [];

/** Every definition key the entries reach through `definitions`, a key it lacks included. */
const reachable = (
  entries: readonly PlutusValidator[],
  definitions: PlutusJson["definitions"],
): Set<string> => {
  const seen = new Set<string>();
  const pending = entries.flatMap(refsOf);
  for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
    if (!seen.has(key)) {
      seen.add(key);
      pending.push(...refsOf(definitions[key]));
    }
  }
  return seen;
};

/** A definition as the encoding sees it: its own title and description dropped, keys sorted. */
const shapeOf = (definition: unknown): string => {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, inner]) => [key, sorted(inner)]),
          )
        : value;
  return JSON.stringify(
    sorted(
      typeof definition === "object" && definition !== null
        ? Object.fromEntries(
            Object.entries(definition).filter(
              ([key]) => key !== "title" && key !== "description",
            ),
          )
        : definition,
    ),
  );
};

/**
 * The record's plutus.json with these build entries in place of their
 * titles (a new title appended) and the build definitions they reach. A
 * definition a kept entry reads with another shape, or one neither file
 * has, is an error.
 */
export const takeFromBuild = (
  env: string,
  snapshot: PlutusJson,
  build: PlutusJson,
  taken: readonly PlutusValidator[],
): Result.Result<PlutusJson, BlueprintError> => {
  const byTitle = new Map(taken.map((v) => [v.title, v]));
  const titles = new Set(snapshot.validators.map((v) => v.title));
  const kept = snapshot.validators.filter((v) => !byTitle.has(v.title));
  const takenKeys = reachable(taken, build.definitions);
  const keptKeys = reachable(kept, snapshot.definitions);
  const missing = [
    ...[...takenKeys].filter((key) => !(key in build.definitions)),
    ...[...keptKeys].filter((key) => !(key in snapshot.definitions)),
  ];
  const conflicting = [...takenKeys].filter(
    (key) =>
      keptKeys.has(key) &&
      key in build.definitions &&
      key in snapshot.definitions &&
      shapeOf(build.definitions[key]) !== shapeOf(snapshot.definitions[key]),
  );
  if (missing.length > 0 || conflicting.length > 0) {
    return Result.fail(
      new BlueprintError({
        environment: env,
        source: "deployed",
        reason: [
          ...(missing.length > 0
            ? [`missing definitions ${missing.join(", ")}`]
            : []),
          ...(conflicting.length > 0
            ? [
                `definitions ${conflicting.join(", ")} differ between the build and the entries the snapshot keeps`,
              ]
            : []),
        ].join("; "),
      }),
    );
  }
  return Result.succeed({
    ...snapshot,
    validators: [
      ...snapshot.validators.map((v) => byTitle.get(v.title) ?? v),
      ...taken.filter((v) => !titles.has(v.title)),
    ],
    definitions: {
      ...snapshot.definitions,
      ...Object.fromEntries(
        [...takenKeys].map((key) => [key, build.definitions[key]]),
      ),
    },
  });
};

/** Whether versions.json promotes the validator with this name; false when the file does not exist. */
export const isPromoted = (env: string, name: string) =>
  Effect.map(
    readVersions(env),
    Option.exists(({ promoted }) => promoted.includes(name)),
  );

/** The validators with these hashes (named through the build plutus.json) that versions.json already promotes. */
export const promotedAmong = (
  env: string,
  plutusPath: string,
  hashes: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    const build = yield* readBuildPlutus(env, plutusPath);
    const names = namesOf(
      yield* Effect.fromResult(deployedAmong(env, plutusPath, build, hashes)),
    );
    const versions = yield* readVersions(env);
    return Option.match(versions, {
      onNone: () => [],
      onSome: ({ promoted }) => names.filter((name) => promoted.includes(name)),
    });
  });

/** The hash the record holds for the build validator with this hash, when versions.json promotes its name: the live contract the build's one stands for. */
export const liveHashOf = (
  env: string,
  plutusPath: string,
  buildHash: string,
) =>
  Effect.gen(function* () {
    const build = yield* readBuildPlutus(env, plutusPath);
    const [entry] = yield* Effect.fromResult(
      deployedAmong(env, plutusPath, build, new Set([buildHash])),
    );
    const name = validatorName(entry.title);
    if (!(yield* isPromoted(env, name))) return Option.none<string>();
    const { plutus: path } = yield* filesOf(env);
    const live = Option.flatMap(
      yield* readFile(env, "deployed", path, PlutusJson),
      (plutus) =>
        Option.fromNullishOr(
          plutus.validators.find((v) => v.title === entry.title),
        ),
    );
    return Option.isSome(live)
      ? Option.some(live.value.hash)
      : yield* new BlueprintError({
          environment: env,
          source: "deployed",
          reason: `versions.json promotes ${name}, but plutus.json has no ${entry.title}`,
        });
  });

/** The name of the record's validator with this hash; None where the environment has no plutus.json or the hash is not in it. */
export const recordedNameOf = (env: string, hash: string) =>
  Effect.gen(function* () {
    const { plutus: path } = yield* filesOf(env);
    return Option.flatMap(
      yield* readFile(env, "deployed", path, PlutusJson),
      (plutus) =>
        Option.map(
          Option.fromNullishOr(plutus.validators.find((v) => v.hash === hash)),
          (v) => validatorName(v.title),
        ),
    );
  });

/** The name of the build validator with this hash in the plutus.json at `plutusPath`; None when the build lacks it. */
export const builtNameOf = (env: string, plutusPath: string, hash: string) =>
  Effect.map(readBuildPlutus(env, plutusPath), (build) =>
    Option.map(
      Option.fromNullishOr(build.validators.find((v) => v.hash === hash)),
      (v) => validatorName(v.title),
    ),
  );

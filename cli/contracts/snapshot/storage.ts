/**
 * The snapshot files on disk, private to snapshot/: schema reads and text
 * writes through the platform FileSystem, versions.json, the deployed and
 * build validators, and taking build entries into a snapshot plutus.json.
 * Every failure is a BlueprintError.
 */
import { FileSystem, type Error as PlatformError } from "@effect/platform";
import { Effect, Either, Option, type Schema } from "effect";
import { BlueprintError } from "../../errors";
import { readJsonFile } from "../../input";
import { PlutusJson, type PlutusValidator, VersionsJson } from "../plutus-json";
import { type DeployedScripts, filesOf } from "./context";

type Source = BlueprintError["source"];

export const blueprintError = (env: string, source: Source, reason: string) =>
  new BlueprintError({ environment: env, source, reason });

export const snapshotError = (env: string, reason: string) =>
  blueprintError(env, "deployed", reason);

/** A FileSystem failure; the platform message names the file. */
export const fsError =
  (env: string, source: Source) =>
  (cause: PlatformError.PlatformError): BlueprintError =>
    blueprintError(env, source, cause.message);

/** A snapshot or build file through its schema; None when the file does not exist. */
export const readSnapshotFile = <A, I>(
  env: string,
  source: Source,
  path: string,
  schema: Schema.Schema<A, I>,
): Effect.Effect<Option.Option<A>, BlueprintError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* Effect.mapError(fs.exists(path), fsError(env, source)))) {
      return Option.none();
    }
    return Option.some(
      yield* readJsonFile(path, schema, (reason) =>
        blueprintError(env, source, `${path}: ${reason}`),
      ),
    );
  });

/** Write text to a file; the failure names the path. */
export const writeText = (
  env: string,
  path: string,
  text: string,
): Effect.Effect<void, BlueprintError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.mapError(fs.writeFileString(path, text), fsError(env, "deployed")),
  );

/** versions.json of an environment; None when the file does not exist. */
export const readVersionsFile = (
  env: string,
): Effect.Effect<
  Option.Option<VersionsJson>,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(filesOf(env), (files) =>
    readSnapshotFile(env, "deployed", files.versions, VersionsJson),
  );

export const writeVersions = (
  env: string,
  data: VersionsJson,
): Effect.Effect<
  void,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(filesOf(env), (files) =>
    writeText(env, files.versions, JSON.stringify(data, null, 2) + "\n"),
  );

/** Validators of the deployed plutus.json; None when the snapshot does not exist. */
export const readDeployedValidators = (
  env: string,
): Effect.Effect<
  Option.Option<readonly PlutusValidator[]>,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(filesOf(env), (files) =>
    Effect.map(
      readSnapshotFile(env, "deployed", files.plutus, PlutusJson),
      Option.map((plutus) => plutus.validators),
    ),
  );

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
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key as keyof typeof value])]),
          )
        : value;
  const own =
    typeof definition === "object" && definition !== null
      ? Object.fromEntries(
          Object.entries(definition).filter(
            ([key]) => key !== "title" && key !== "description",
          ),
        )
      : definition;
  return JSON.stringify(sorted(own));
};

/** The snapshot with these build entries in place of their titles (a new title appended) and the build definitions they reach; a definition a kept entry reads with another shape, or one neither file has, is an error. */
export const takeFromBuild = (
  env: string,
  snapshot: PlutusJson,
  build: PlutusJson,
  taken: readonly PlutusValidator[],
): Either.Either<PlutusJson, BlueprintError> => {
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
    return Either.left(
      snapshotError(
        env,
        [
          missing.length > 0 ? `missing definitions ${missing.join(", ")}` : [],
          conflicting.length > 0
            ? `definitions ${conflicting.join(", ")} differ between the build and the entries the snapshot keeps`
            : [],
        ]
          .flat()
          .join("; "),
      ),
    );
  }
  return Either.right({
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

/** The build plutus.json; a missing file names the build to run. */
export const readBuildPlutus = (
  env: string,
  plutusPath: string,
): Effect.Effect<PlutusJson, BlueprintError, FileSystem.FileSystem> =>
  Effect.flatMap(
    readSnapshotFile(env, "build", plutusPath, PlutusJson),
    Option.match({
      onNone: () =>
        Effect.fail(
          blueprintError(
            env,
            "build",
            `build plutus.json not found at ${plutusPath}. Run 'just build' first.`,
          ),
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
): Either.Either<PlutusValidator[], BlueprintError> => {
  const known = new Set(build.validators.map((v) => v.hash));
  const missing = [...hashes].filter((hash) => !known.has(hash));
  return missing.length > 0
    ? Either.left(
        blueprintError(
          env,
          "build",
          `the build lacks the validators with hashes ${missing.join(", ")}; the blueprint and ${plutusPath} are from different builds`,
        ),
      )
    : Either.right(build.validators.filter((v) => hashes.has(v.hash)));
};

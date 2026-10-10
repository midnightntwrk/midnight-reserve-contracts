/**
 * The deployed-scripts snapshot of an environment: plutus.json, the
 * generated blueprint, versions.json (promoted and staged validators) and
 * changelog.json, in `<root>/<env>/` where the DeployedScripts service
 * names the root (the repository's deployed-scripts/, or a temporary
 * directory in tests). The reads and writes go through the platform
 * FileSystem, the git and blueprint-generator runs through Command; the
 * parsers are Either.
 */
import { resolve } from "path";
import {
  Command,
  type CommandExecutor,
  FileSystem,
  type Error as PlatformError,
} from "@effect/platform";
import { Context, Effect, Either, Layer, Option, type Schema } from "effect";
import { BlueprintError } from "../errors";
import {
  Changelog,
  type ChangeRecord,
  PlutusJson,
  type PlutusValidator,
  VersionsJson,
} from "./plutus-json";
import { readJsonFile } from "../input";
import { PROJECT_ROOT } from "./paths";

type Source = BlueprintError["source"];

const blueprintError = (env: string, source: Source, reason: string) =>
  new BlueprintError({ environment: env, source, reason });

const snapshotError = (env: string, reason: string) =>
  blueprintError(env, "deployed", reason);

/** A FileSystem failure; the platform message names the file. */
const fsError =
  (env: string, source: Source) =>
  (cause: PlatformError.PlatformError): BlueprintError =>
    blueprintError(env, source, cause.message);

/** The directory that holds each environment's snapshot. */
export class DeployedScripts extends Context.Tag("DeployedScripts")<
  DeployedScripts,
  { readonly root: string }
>() {}

/** The repository's deployed-scripts/. */
export const DeployedScriptsLive = Layer.succeed(DeployedScripts, {
  root: resolve(PROJECT_ROOT, "deployed-scripts"),
});

/** Snapshots under `root`. */
export const DeployedScriptsAt = (root: string) =>
  Layer.succeed(DeployedScripts, { root });

/** The snapshot directory of an environment. */
export const snapshotDirOf = (
  env: string,
): Effect.Effect<string, never, DeployedScripts> =>
  Effect.map(DeployedScripts, ({ root }) => resolve(root, env));

/** The files of an environment's snapshot. */
const filesOf = (env: string) => Effect.map(snapshotDirOf(env), snapshotFiles);

/** A snapshot or build file through its schema; None when the file does not exist. */
const readSnapshotFile = <A, I>(
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
const writeText = (
  env: string,
  path: string,
  text: string,
): Effect.Effect<void, BlueprintError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.mapError(fs.writeFileString(path, text), fsError(env, "deployed")),
  );

/** versions.json of an environment; None when the file does not exist. */
export const readVersions = (
  env: string,
): Effect.Effect<
  Option.Option<VersionsJson>,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(filesOf(env), (files) =>
    readSnapshotFile(env, "deployed", files.versions, VersionsJson),
  );

/** An environment's deployed record: the plutus.json validators and versions.json. */
export interface DeployedRecord {
  readonly validators: readonly PlutusValidator[];
  readonly versions: VersionsJson;
}

/** The deployed record of an environment; a missing file is a BlueprintError. */
export const readRecord = (
  env: string,
): Effect.Effect<
  DeployedRecord,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.gen(function* () {
    const files = yield* filesOf(env);
    const required = <A, I>(path: string, schema: Schema.Schema<A, I>) =>
      Effect.flatMap(
        readSnapshotFile(env, "deployed", path, schema),
        Option.match({
          onNone: () =>
            Effect.fail(snapshotError(env, `${path} does not exist`)),
          onSome: Effect.succeed,
        }),
      );
    const { validators } = yield* required(files.plutus, PlutusJson);
    const versions = yield* required(files.versions, VersionsJson);
    return { validators, versions };
  });

const writeVersions = (
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
const readDeployedValidators = (
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

/** "module.name.else" -> "name"; the module prefix and a trailing else/spend are dropped. */
export const validatorName = (title: string): string => {
  const parts = title.split(".");
  const last = parts[parts.length - 1];
  return (
    last === "else" || last === "spend" ? parts.slice(1, -1) : parts.slice(1)
  ).join(".");
};

/** Whether `name` is a logic of `track`: `<track>_logic`, or `<track>_logic_v<N>` for any N from 2 up. */
export const isTrackLogic = (track: string, name: string): boolean =>
  name === `${track}_logic` ||
  new RegExp(`^${track}_logic_v([2-9]|[1-9][0-9]+)$`).test(name);

/** Add a validator to staged[]; false when versions.json is missing. */
export const stageValidator = (
  env: string,
  name: string,
): Effect.Effect<
  boolean,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(readVersions(env), (data) => {
    if (Option.isNone(data)) return Effect.succeed(false);
    if (data.value.staged.includes(name)) return Effect.succeed(true);
    return Effect.map(
      writeVersions(env, {
        ...data.value,
        staged: [...data.value.staged, name],
      }),
      () => true,
    );
  });

/** Move a validator from staged[] to promoted[]; false when versions.json is missing. */
export const promoteValidatorVersion = (
  env: string,
  name: string,
): Effect.Effect<
  boolean,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(readVersions(env), (data) => {
    if (Option.isNone(data)) return Effect.succeed(false);
    const { promoted, staged } = data.value;
    return Effect.map(
      writeVersions(env, {
        promoted: promoted.includes(name) ? promoted : [...promoted, name],
        staged: staged.filter((s) => s !== name),
      }),
      () => true,
    );
  });

/** The validator name (e.g. "council_logic_v2") behind a deployed script hash. */
export const validatorNameByHash = (
  env: string,
  hash: string,
): Effect.Effect<
  Option.Option<string>,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.map(readDeployedValidators(env), (validators) =>
    Option.flatMap(validators, (all) =>
      Option.map(Option.fromNullable(all.find((v) => v.hash === hash)), (v) =>
        validatorName(v.title),
      ),
    ),
  );

/** The installed blueprint generator; bun runs it, so no registry is reached. */
const BLUEPRINT_CLI = resolve(PROJECT_ROOT, "node_modules/.bin/blueprint");

/** Generate the TypeScript blueprint of a plutus.json; the generator's stderr reaches the user, its one-line stdout does not. */
export const generateBlueprint = (
  env: string,
  source: "deployed" | "build",
  plutusPath: string,
  outputPath: string,
): Effect.Effect<void, BlueprintError, CommandExecutor.CommandExecutor> => {
  const failure = (reason: string) =>
    new BlueprintError({ environment: env, source, reason });
  return Effect.flatMap(
    Effect.mapError(
      Command.make(
        process.execPath,
        BLUEPRINT_CLI,
        plutusPath,
        "-o",
        outputPath,
      ).pipe(Command.stderr("inherit"), Command.exitCode),
      (cause) => failure(`blueprint generation failed: ${cause.message}`),
    ),
    (exitCode) =>
      exitCode === 0
        ? Effect.void
        : Effect.fail(
            failure(`blueprint generation failed with exit code ${exitCode}`),
          ),
  );
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
const takeFromBuild = (
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
const readBuildPlutus = (
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

/** The validator name behind a script hash in the build plutus.json at `plutusPath`. */
export const buildValidatorNameByHash = (
  env: string,
  hash: string,
  plutusPath: string,
): Effect.Effect<
  Option.Option<string>,
  BlueprintError,
  FileSystem.FileSystem
> =>
  Effect.map(readBuildPlutus(env, plutusPath), (build) =>
    Option.map(
      Option.fromNullable(build.validators.find((v) => v.hash === hash)),
      (v) => validatorName(v.title),
    ),
  );

/** The deployed plutus.json and blueprint with one build validator taken in, prepared and not yet written. */
export interface PreparedMerge {
  readonly plutusPath: string;
  readonly plutusText: string;
  readonly blueprintPath: string;
  readonly blueprintText: string;
}

/** Take the build validator with this hash into the deployed plutus.json (in place, or appended) and generate the blueprint, writing nothing; versions.json is untouched. */
export const prepareValidatorMerge = (
  env: string,
  targetHash: string,
  buildPlutusJsonPath: string,
): Effect.Effect<
  PreparedMerge,
  BlueprintError,
  FileSystem.FileSystem | CommandExecutor.CommandExecutor | DeployedScripts
> =>
  Effect.gen(function* () {
    const files = yield* filesOf(env);
    const deployed = yield* readSnapshotFile(
      env,
      "deployed",
      files.plutus,
      PlutusJson,
    );
    if (Option.isNone(deployed)) {
      return yield* snapshotError(
        env,
        "plutus.json not found. Deploy first before staging an upgrade.",
      );
    }
    const build = yield* readBuildPlutus(env, buildPlutusJsonPath);
    const target = build.validators.find((v) => v.hash === targetHash);
    if (!target) {
      return yield* blueprintError(
        env,
        "build",
        `validator with hash '${targetHash}' not found in build plutus.json (${buildPlutusJsonPath}).`,
      );
    }
    const merged = yield* takeFromBuild(env, deployed.value, build, [target]);
    const plutusText = JSON.stringify(merged, null, 2) + "\n";
    return {
      plutusPath: files.plutus,
      plutusText,
      blueprintPath: files.blueprint,
      blueprintText: yield* Effect.scoped(generatedBlueprint(env, plutusText)),
    };
  });

/** Write a prepared merge: the deployed plutus.json, then its blueprint. */
export const writeValidatorMerge = (env: string, prepared: PreparedMerge) =>
  Effect.zipRight(
    writeText(env, prepared.plutusPath, prepared.plutusText),
    writeText(env, prepared.blueprintPath, prepared.blueprintText),
  );

/** How a deploy updates a snapshot: "replace" starts it again from the build output; "extend" keeps it and records the deployed validators. */
export type SnapshotRule = "replace" | "extend";

/** A snapshot directory's files. */
const snapshotFiles = (snapshotDir: string) => ({
  plutus: resolve(snapshotDir, "plutus.json"),
  blueprint: resolve(snapshotDir, "contract_blueprint.ts"),
  versions: resolve(snapshotDir, "versions.json"),
  changelog: resolve(snapshotDir, "changelog.json"),
});

/** The build validators with these hashes; a hash the build lacks is an error, so no deployed validator goes unrecorded. */
const deployedAmong = (
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

const namesOf = (validators: readonly PlutusValidator[]): string[] => [
  ...new Set(validators.map((v) => validatorName(v.title))),
];

/** The validators with these hashes (named through the build plutus.json) that the snapshot's versions.json already promotes. */
export const promotedAmong = (
  env: string,
  plutusPath: string,
  hashes: ReadonlySet<string>,
): Effect.Effect<
  string[],
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.gen(function* () {
    const build = yield* readBuildPlutus(env, plutusPath);
    const names = namesOf(yield* deployedAmong(env, plutusPath, build, hashes));
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
): Effect.Effect<
  Option.Option<string>,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.gen(function* () {
    const build = yield* readBuildPlutus(env, plutusPath);
    const [entry] = yield* deployedAmong(
      env,
      plutusPath,
      build,
      new Set([buildHash]),
    );
    const name = validatorName(entry.title);
    const versions = yield* readVersions(env);
    if (!Option.exists(versions, ({ promoted }) => promoted.includes(name))) {
      return Option.none();
    }
    const live = Option.flatMap(yield* readDeployedValidators(env), (all) =>
      Option.fromNullable(all.find((v) => v.title === entry.title)),
    );
    return Option.isSome(live)
      ? Option.some(live.value.hash)
      : yield* snapshotError(
          env,
          `versions.json promotes ${name}, but plutus.json has no ${entry.title}`,
        );
  });

/** A deploy's snapshot update: the environment, the rule, the validators the deploy creates and the build ones its datums install, the build output and the time. */
export interface DeploySnapshot {
  readonly env: string;
  readonly rule: SnapshotRule;
  readonly createdHashes: ReadonlySet<string>;
  readonly installedHashes: ReadonlySet<string>;
  readonly plutusPath: string;
  readonly blueprintPath: string;
  readonly timestamp: string;
}

/** A snapshot ready to write: its directory and the text of its four files. */
export interface PreparedSnapshot {
  readonly dir: string;
  readonly texts: Record<keyof ReturnType<typeof snapshotFiles>, string>;
}

/** A deploy's snapshot, read and generated before any chain call: a replace starts again from the build; an extend takes the build entries the deploy creates or installs and keeps every other entry. */
export const prepareDeploySnapshot = (
  snapshot: DeploySnapshot,
): Effect.Effect<
  PreparedSnapshot,
  BlueprintError,
  FileSystem.FileSystem | CommandExecutor.CommandExecutor | DeployedScripts
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const { env, rule, plutusPath } = snapshot;
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* snapshotDirOf(env);
      const files = snapshotFiles(dir);
      const build = yield* readBuildPlutus(env, plutusPath);
      const createdEntries = yield* deployedAmong(
        env,
        plutusPath,
        build,
        snapshot.createdHashes,
      );
      const installedEntries = yield* deployedAmong(
        env,
        plutusPath,
        build,
        snapshot.installedHashes,
      );
      const taken = [...createdEntries, ...installedEntries];
      const created = namesOf(createdEntries);
      const recorded = namesOf(taken);

      const previous =
        rule === "replace"
          ? Option.none()
          : yield* readSnapshotFile(env, "deployed", files.plutus, PlutusJson);
      const versions =
        rule === "replace"
          ? Option.none()
          : yield* readSnapshotFile(
              env,
              "deployed",
              files.versions,
              VersionsJson,
            );
      const plutus = yield* Option.match(previous, {
        onNone: () => Either.right(build),
        onSome: (snapshotPlutus) =>
          takeFromBuild(env, snapshotPlutus, build, taken),
      });
      const nextVersions: VersionsJson = Option.match(versions, {
        onNone: () => ({ promoted: recorded, staged: [] }),
        onSome: ({ promoted, staged }) => ({
          promoted: [...new Set([...promoted, ...recorded])],
          staged,
        }),
      });
      const { timestamp } = snapshot;
      const initial = created.map((validator): ChangeRecord => ({
        type: "initial",
        validator,
        description: "Initial deployment",
        timestamp,
      }));
      const previousLog =
        rule === "replace"
          ? Option.none()
          : yield* readSnapshotFile(
              env,
              "deployed",
              files.changelog,
              Changelog,
            );
      const changelog: Changelog = Option.match(previousLog, {
        onNone: () => ({
          timestamp,
          changes:
            rule === "replace"
              ? [
                  {
                    type: "initial",
                    validator: "all",
                    description: "Initial deployment",
                    timestamp,
                  },
                ]
              : initial,
        }),
        onSome: (log) => ({ ...log, changes: [...log.changes, ...initial] }),
      });

      const plutusText = JSON.stringify(plutus, null, 2) + "\n";
      const blueprint =
        rule === "replace"
          ? yield* Effect.mapError(
              fs.readFileString(snapshot.blueprintPath),
              fsError(env, "build"),
            )
          : yield* generatedBlueprint(env, plutusText);
      return {
        dir,
        texts: {
          plutus: plutusText,
          blueprint,
          versions: JSON.stringify(nextVersions, null, 2) + "\n",
          changelog: JSON.stringify(changelog, null, 2) + "\n",
        },
      };
    }),
  );

/** Write a prepared snapshot's four files. */
export const writeDeploySnapshot = (
  env: string,
  prepared: PreparedSnapshot,
): Effect.Effect<void, BlueprintError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = snapshotFiles(prepared.dir);
    yield* Effect.mapError(
      fs.makeDirectory(prepared.dir, { recursive: true }),
      fsError(env, "deployed"),
    );
    yield* writeText(env, files.plutus, prepared.texts.plutus);
    yield* writeText(env, files.blueprint, prepared.texts.blueprint);
    yield* writeText(env, files.versions, prepared.texts.versions);
    yield* writeText(env, files.changelog, prepared.texts.changelog);
  });

/** The blueprint the generator makes from plutus.json text, in a scoped temporary directory. */
const generatedBlueprint = (env: string, plutusText: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* Effect.mapError(
      fs.makeTempDirectoryScoped({ prefix: "snapshot-" }),
      (cause) => blueprintError(env, "deployed", cause.message),
    );
    const plutusPath = resolve(dir, "plutus.json");
    const blueprintPath = resolve(dir, "contract_blueprint.ts");
    yield* writeText(env, plutusPath, plutusText);
    yield* generateBlueprint(env, "deployed", plutusPath, blueprintPath);
    return yield* Effect.mapError(
      fs.readFileString(blueprintPath),
      fsError(env, "deployed"),
    );
  });

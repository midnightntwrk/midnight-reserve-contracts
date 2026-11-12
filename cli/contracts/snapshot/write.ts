/**
 * Snapshot writes. A command prepares each RecordUpdate (reads and
 * generation, no writes) during resolve and applies it where it writes
 * today; applyRecordUpdate is the one write path and returns what each
 * update did, for the command to print.
 */
import { type CommandExecutor, FileSystem } from "@effect/platform";
import { Effect, Either, Option } from "effect";
import type { BlueprintError } from "../../errors";
import { generatedBlueprint } from "../bindings";
import {
  Changelog,
  type ChangeRecord,
  PlutusJson,
  VersionsJson,
} from "../plutus-json";
import {
  type DeployedScripts,
  filesOf,
  type SnapshotFiles,
  snapshotDirOf,
  snapshotFiles,
} from "./context";
import { namesOf } from "./names";
import {
  blueprintError,
  deployedAmong,
  fsError,
  readBuildPlutus,
  readSnapshotFile,
  readVersionsFile,
  snapshotError,
  takeFromBuild,
  writeText,
  writeVersions,
} from "./storage";

/** Add a validator to staged[]; false when versions.json is missing. */
const stageValidator = (
  env: string,
  name: string,
): Effect.Effect<
  boolean,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(readVersionsFile(env), (data) => {
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
const promoteValidatorVersion = (
  env: string,
  name: string,
): Effect.Effect<
  boolean,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(readVersionsFile(env), (data) => {
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
const writeValidatorMerge = (env: string, prepared: PreparedMerge) =>
  Effect.zipRight(
    writeText(env, prepared.plutusPath, prepared.plutusText),
    writeText(env, prepared.blueprintPath, prepared.blueprintText),
  );

/** How a deploy updates a snapshot: "replace" starts it again from the build output; "extend" keeps it and records the deployed validators. */
export type SnapshotRule = "replace" | "extend";

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
  readonly texts: Record<keyof SnapshotFiles, string>;
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
const writeDeploySnapshot = (
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

/** A snapshot update, prepared and not yet written: a deploy's whole snapshot, a build validator merged into the record, or a name tracked in versions.json. */
export type RecordUpdate =
  | { readonly _tag: "Deploy"; readonly prepared: PreparedSnapshot }
  | {
      readonly _tag: "Merge";
      readonly name: string;
      readonly prepared: PreparedMerge;
    }
  | {
      readonly _tag: "Track";
      readonly as: "staged" | "promoted";
      readonly name: string;
    };

/** What an applied update did; a Track without versions.json writes nothing and is VersionsMissing. */
export type RecordOutcome =
  | { readonly _tag: "Saved"; readonly dir: string }
  | { readonly _tag: "Merged"; readonly name: string }
  | {
      readonly _tag: "Tracked";
      readonly as: "staged" | "promoted";
      readonly name: string;
    }
  | {
      readonly _tag: "VersionsMissing";
      readonly as: "staged" | "promoted";
      readonly name: string;
    };

/** Write the updates in order; the first failure stops the rest. */
export const applyRecordUpdate = (
  env: string,
  updates: readonly RecordUpdate[],
): Effect.Effect<
  readonly RecordOutcome[],
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.forEach(
    updates,
    (
      update,
    ): Effect.Effect<
      RecordOutcome,
      BlueprintError,
      FileSystem.FileSystem | DeployedScripts
    > => {
      switch (update._tag) {
        case "Deploy":
          return Effect.as(writeDeploySnapshot(env, update.prepared), {
            _tag: "Saved",
            dir: update.prepared.dir,
          });
        case "Merge":
          return Effect.as(writeValidatorMerge(env, update.prepared), {
            _tag: "Merged",
            name: update.name,
          });
        case "Track": {
          const { as, name } = update;
          return Effect.map(
            as === "staged"
              ? stageValidator(env, name)
              : promoteValidatorVersion(env, name),
            (found): RecordOutcome => ({
              _tag: found ? "Tracked" : "VersionsMissing",
              as,
              name,
            }),
          );
        }
      }
    },
  );

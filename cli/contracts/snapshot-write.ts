/**
 * The deployed-scripts record, written. A command prepares each
 * RecordUpdate (reads and bindings generation, no writes) before any chain
 * call, and applies it after; applyRecordUpdate is the one write path and
 * returns what each update did, for the command to print.
 */
import { resolve } from "path";
import { Effect, FileSystem, Option } from "effect";
import { BlueprintError } from "../errors";
import { generateBindings } from "./build";
import type { SnapshotRule } from "./resolver";
import {
  Changelog,
  type ChangeRecord,
  deployedAmong,
  filesOf,
  namesOf,
  PlutusJson,
  readBuildPlutus,
  readFile,
  readVersions,
  takeFromBuild,
  type VersionsJson,
} from "./snapshot-read";

/** The bindings the generator makes from plutus.json text, through a temporary directory that is removed afterwards. */
const bindingsOf = (env: string, plutusText: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const failure = (cause: { readonly message: string }) =>
        new BlueprintError({
          environment: env,
          source: "deployed",
          reason: cause.message,
        });
      const dir = yield* Effect.mapError(
        fs.makeTempDirectoryScoped({ prefix: "snapshot-" }),
        failure,
      );
      const plutusPath = resolve(dir, "plutus.json");
      const blueprintPath = resolve(dir, "contract_blueprint.ts");
      yield* Effect.mapError(
        fs.writeFileString(plutusPath, plutusText),
        failure,
      );
      yield* generateBindings(env, "deployed", plutusPath, blueprintPath);
      return yield* Effect.mapError(fs.readFileString(blueprintPath), failure);
    }),
  );

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** A deploy's record update: the rule, the validators the deploy creates and the build ones its datums install (by hash), the build output and the time. */
export interface DeploySnapshot {
  readonly env: string;
  readonly rule: SnapshotRule;
  readonly createdHashes: ReadonlySet<string>;
  readonly installedHashes: ReadonlySet<string>;
  readonly plutusPath: string;
  readonly blueprintPath: string;
  readonly timestamp: string;
}

/** Files ready to write, path to text, in write order. */
type Prepared = readonly (readonly [path: string, text: string])[];

/** A record update, prepared and not yet written. */
export type RecordUpdate =
  /** A deploy's whole record, or one build validator merged into it. */
  | {
      readonly _tag: "Deploy" | "Merge";
      readonly name: string;
      readonly dir: string;
      readonly files: Prepared;
    }
  /** A name moved into versions.json's staged[] or promoted[]. */
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
      readonly _tag: "Tracked" | "VersionsMissing";
      readonly as: "staged" | "promoted";
      readonly name: string;
    };

/**
 * A deploy's record, read and generated before any chain call. A replace
 * starts it again from the build output; an extend takes the build entries
 * the deploy creates or installs into the record's plutus.json and keeps
 * every other entry, promotes their names and appends the created ones to
 * the changelog.
 */
export const prepareDeploySnapshot = (snapshot: DeploySnapshot) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { env, rule, plutusPath, timestamp } = snapshot;
    const files = yield* filesOf(env);
    const build = yield* readBuildPlutus(env, plutusPath);
    const created = yield* Effect.fromResult(
      deployedAmong(env, plutusPath, build, snapshot.createdHashes),
    );
    const installed = yield* Effect.fromResult(
      deployedAmong(env, plutusPath, build, snapshot.installedHashes),
    );
    const recorded = namesOf([...created, ...installed]);
    const previous =
      rule === "replace"
        ? Option.none()
        : yield* readFile(env, "deployed", files.plutus, PlutusJson);
    const versions =
      rule === "replace" ? Option.none() : yield* readVersions(env);
    const log =
      rule === "replace"
        ? Option.none()
        : yield* readFile(env, "deployed", files.changelog, Changelog);
    const plutus = Option.isSome(previous)
      ? yield* Effect.fromResult(
          takeFromBuild(env, previous.value, build, [...created, ...installed]),
        )
      : build;
    const nextVersions: VersionsJson = Option.match(versions, {
      onNone: () => ({ promoted: recorded, staged: [] }),
      onSome: ({ promoted, staged }) => ({
        promoted: [...new Set([...promoted, ...recorded])],
        staged,
      }),
    });
    const initial = namesOf(created).map((validator): ChangeRecord => ({
      type: "initial",
      validator,
      description: "Initial deployment",
      timestamp,
    }));
    const changelog: Changelog = Option.match(log, {
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
      onSome: (previousLog) => ({
        ...previousLog,
        changes: [...previousLog.changes, ...initial],
      }),
    });
    const plutusText = json(plutus);
    const blueprint =
      rule === "replace"
        ? yield* Effect.mapError(
            fs.readFileString(snapshot.blueprintPath),
            (cause) =>
              new BlueprintError({
                environment: env,
                source: "build",
                reason: cause.message,
              }),
          )
        : yield* bindingsOf(env, plutusText);
    return {
      _tag: "Deploy",
      name: env,
      dir: files.dir,
      files: [
        [files.plutus, plutusText],
        [files.blueprint, blueprint],
        [files.versions, json(nextVersions)],
        [files.changelog, json(changelog)],
      ],
    } satisfies RecordUpdate;
  });

/** The record's plutus.json with the build validator of this hash taken in (in place, or appended) and its bindings regenerated, writing nothing; versions.json is untouched. */
export const prepareValidatorMerge = (
  env: string,
  name: string,
  targetHash: string,
  buildPlutusPath: string,
) =>
  Effect.gen(function* () {
    const files = yield* filesOf(env);
    const deployed = yield* readFile(env, "deployed", files.plutus, PlutusJson);
    if (Option.isNone(deployed)) {
      return yield* new BlueprintError({
        environment: env,
        source: "deployed",
        reason:
          "plutus.json not found. Deploy first before staging an upgrade.",
      });
    }
    const build = yield* readBuildPlutus(env, buildPlutusPath);
    const target = build.validators.find((v) => v.hash === targetHash);
    if (target === undefined) {
      return yield* new BlueprintError({
        environment: env,
        source: "build",
        reason: `validator with hash '${targetHash}' not found in build plutus.json (${buildPlutusPath}).`,
      });
    }
    const plutusText = json(
      yield* Effect.fromResult(
        takeFromBuild(env, deployed.value, build, [target]),
      ),
    );
    return {
      _tag: "Merge",
      name,
      dir: files.dir,
      files: [
        [files.plutus, plutusText],
        [files.blueprint, yield* bindingsOf(env, plutusText)],
      ],
    } satisfies RecordUpdate;
  });

/** Write the updates in order; the first failure stops the rest. */
export const applyRecordUpdate = (
  env: string,
  updates: readonly RecordUpdate[],
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const failure = (cause: { readonly message: string }) =>
      new BlueprintError({
        environment: env,
        source: "deployed",
        reason: cause.message,
      });
    const outcomes: RecordOutcome[] = [];
    for (const update of updates) {
      if (update._tag !== "Track") {
        yield* Effect.mapError(
          fs.makeDirectory(update.dir, { recursive: true }),
          failure,
        );
        for (const [path, text] of update.files) {
          yield* Effect.mapError(fs.writeFileString(path, text), failure);
        }
        outcomes.push(
          update._tag === "Deploy"
            ? { _tag: "Saved", dir: update.dir }
            : { _tag: "Merged", name: update.name },
        );
        continue;
      }
      const { as, name } = update;
      const versions = yield* readVersions(env);
      if (Option.isNone(versions)) {
        outcomes.push({ _tag: "VersionsMissing", as, name });
        continue;
      }
      const { promoted, staged } = versions.value;
      const next: VersionsJson =
        as === "staged"
          ? {
              promoted,
              staged: staged.includes(name) ? staged : [...staged, name],
            }
          : {
              promoted: promoted.includes(name)
                ? promoted
                : [...promoted, name],
              staged: staged.filter((s) => s !== name),
            };
      if (as === "promoted" || !staged.includes(name)) {
        const { versions: path } = yield* filesOf(env);
        yield* Effect.mapError(fs.writeFileString(path, json(next)), failure);
      }
      outcomes.push({ _tag: "Tracked", as, name });
    }
    return outcomes;
  });

/**
 * Snapshot reads: versions.json, the deployed record, validator names by
 * hash in the snapshot or a build plutus.json, and which build validators
 * the snapshot promotes. Nothing here writes.
 */
import type { FileSystem } from "@effect/platform";
import { Effect, Option, type Schema } from "effect";
import type { BlueprintError } from "../../errors";
import { readJsonFile } from "../../input";
import { PlutusJson, type PlutusValidator, VersionsJson } from "../plutus-json";
import { type DeployedScripts, filesOf } from "./context";
import { namesOf, validatorName } from "./names";
import {
  blueprintError,
  deployedAmong,
  readBuildPlutus,
  readDeployedValidators,
  readSnapshotFile,
  readVersionsFile,
  snapshotError,
} from "./storage";

/** versions.json of an environment; None when the file does not exist. */
export const readVersions = (
  env: string,
): Effect.Effect<
  Option.Option<VersionsJson>,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> => readVersionsFile(env);

/** Whether versions.json promotes the validator with this name; false when the file does not exist. */
export const isPromoted = (
  env: string,
  name: string,
): Effect.Effect<
  boolean,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.map(
    readVersions(env),
    Option.exists(({ promoted }) => promoted.includes(name)),
  );

/** A deployed plutus.json and the path it was read from. */
export interface DeployedPlutus {
  readonly path: string;
  readonly plutus: PlutusJson;
}

/** The deployed plutus.json of an environment; a missing or malformed file is a BlueprintError naming its path. */
export const readDeployedPlutus = (
  env: string,
): Effect.Effect<
  DeployedPlutus,
  BlueprintError,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.flatMap(filesOf(env), (files) =>
    Effect.map(
      readJsonFile(files.plutus, PlutusJson, (reason) =>
        blueprintError(env, "deployed", `${files.plutus}: ${reason}`),
      ),
      (plutus) => ({ path: files.plutus, plutus }),
    ),
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

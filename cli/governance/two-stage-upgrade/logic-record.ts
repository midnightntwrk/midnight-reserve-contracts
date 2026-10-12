/**
 * The logic a stage-upgrade names and the deployed-scripts record updates of
 * stage and promote: copying a build-only logic into the record and tracking
 * the validator as staged or promoted. The only module of governance/ that
 * imports contracts/snapshot/write.
 */
import { Effect, Option } from "effect";
import type { FileSystem } from "@effect/platform";
import type { Environment, Profile } from "../../config/network-mapping";
import { hasDeployedScripts } from "../../contracts/contracts";
import type { DeployedScripts } from "../../contracts/snapshot/context";
import {
  buildValidatorNameByHash,
  isPromoted,
  validatorNameByHash,
} from "../../contracts/snapshot/read";
import {
  applyRecordUpdate,
  type PreparedMerge,
  prepareValidatorMerge,
  type RecordOutcome,
  type RecordUpdate,
} from "../../contracts/snapshot/write";
import { type BlueprintError, PreconditionFailed } from "../../errors";
import type { ScriptHash } from "../../input";
import { Output } from "../../output";

/** The build output a stage copies a new logic from. */
export interface LogicBuild {
  readonly profile: Profile;
  readonly plutusPath: string;
}

/** The logic to stage by name: from the record, or from the build (Some path: copy it into the record, which overwrites an unpromoted entry of that name); a hash in neither, or a build logic whose name is promoted, is refused. */
export const logicToStage = (
  environment: string,
  hash: ScriptHash,
  build: LogicBuild,
): Effect.Effect<
  { readonly name: string; readonly copyFrom: Option.Option<string> },
  BlueprintError | PreconditionFailed,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.gen(function* () {
    const recorded = yield* validatorNameByHash(environment, hash);
    if (Option.isSome(recorded))
      return { name: recorded.value, copyFrom: Option.none() };
    const built = yield* buildValidatorNameByHash(
      environment,
      hash,
      build.plutusPath,
    );
    if (Option.isNone(built))
      return yield* new PreconditionFailed({
        command: "stage-upgrade",
        refusal: {
          _tag: "LogicNotFound",
          logicHash: hash,
          environment,
          profile: build.profile,
          buildPath: build.plutusPath,
        },
      });
    if (yield* isPromoted(environment, built.value))
      return yield* new PreconditionFailed({
        command: "stage-upgrade",
        refusal: {
          _tag: "PromotedLogicMoved",
          name: built.value,
          logicHash: hash,
          environment,
          profile: build.profile,
        },
      });
    return { name: built.value, copyFrom: Option.some(build.plutusPath) };
  });

/** The record copy of a build-only logic, prepared and not written; None where the environment keeps no record or the logic is already in it. */
export const prepareLogicCopy = (
  environment: Environment,
  hash: ScriptHash,
  copyFrom: Option.Option<string>,
) =>
  Effect.transposeOption(
    Option.map(
      Option.filter(copyFrom, () => hasDeployedScripts(environment)),
      (plutusPath) => prepareValidatorMerge(environment, hash, plutusPath),
    ),
  );

/** What a stage records: the copied logic, then, unless it re-stages a promoted validator, its tracking as staged. */
export const stageRecord = (
  name: string,
  copy: Option.Option<PreparedMerge>,
  restage: boolean,
): RecordUpdate[] => [
  ...Option.toArray(
    Option.map(copy, (prepared): RecordUpdate => ({
      _tag: "Merge",
      name,
      prepared,
    })),
  ),
  ...(restage ? [] : [{ _tag: "Track", as: "staged", name } as const]),
];

/** What a promote records: the staged logic's validator tracked as promoted, by its recorded name or else its hash. */
export const promoteRecord = (environment: string, stagedLogicHash: string) =>
  Effect.map(
    validatorNameByHash(environment, stagedLogicHash),
    (name): RecordUpdate[] => [
      {
        _tag: "Track",
        as: "promoted",
        name: Option.getOrElse(name, () => stagedLogicHash),
      },
    ],
  );

/** The lines stage and promote print for what the record update did. */
const renderRecord = (network: string, outcomes: readonly RecordOutcome[]) =>
  Effect.flatMap(Output, (out) =>
    Effect.forEach(
      outcomes,
      (outcome) => {
        switch (outcome._tag) {
          case "Merged":
            return out.success(
              `Added ${outcome.name} to deployed-scripts/${network}/plutus.json`,
            );
          case "Tracked":
            return out.success(
              `Tracked ${outcome.name} as ${outcome.as} in versions.json`,
            );
          case "VersionsMissing":
            return out.stderr(
              `Warning: Could not track ${outcome.as} validator — versions.json not found for ${network}`,
            );
          case "Saved":
            return Effect.void;
        }
      },
      { discard: true },
    ),
  );

/** Write the record updates and print what they did. */
export const applyRecord = (network: string, record: readonly RecordUpdate[]) =>
  Effect.flatMap(applyRecordUpdate(network, record), (outcomes) =>
    renderRecord(network, outcomes),
  );

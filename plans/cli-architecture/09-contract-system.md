# Phase 09 — Contract system

Runs after 01 and before 06 and 07 (numbered last to keep the other
files' numbers; plans/effect ran 08 and 09 before 05 the same way).

The contract system produces and records the scripts transactions use. It
has four parts, and today two of them share `contracts/versions.ts`
(724 lines):

| Part | Today | Consumers |
|---|---|---|
| Build | `contracts/build-engine.ts`, `contracts/build.ts` | `commands/build.ts` |
| Bindings (TypeScript blueprint generation) | `generateBlueprint` in `versions.ts` | `build.ts`, the snapshot writes |
| Deployed-scripts snapshot | `versions.ts`: reads (`readVersions`, `readRecord`, names, `promotedAmong`, `liveHashOf`) and writes (`stageValidator`, `promoteValidatorVersion`, validator merge, deploy snapshot) | build-engine (from-deployed pins), deploy, staging-track, two-stage-upgrade, verify |
| Resolution | `Blueprint` (`contracts/contracts.ts`), deployed or build source | every transaction command, `report/` |

The snapshot is a manifest the CLI writes, not chain truth; `verify` is
what compares it with the chain.

## Target

```
contracts/
  build-engine.ts   build.ts          unchanged; build-engine reads the snapshot through snapshot/read only
  bindings.ts                         generateBlueprint, generatedBlueprint (from versions.ts)
  snapshot/
    context.ts                        DeployedScripts (+ Live/At), snapshotDirOf, snapshotFiles, filesOf: the root and paths
    names.ts                          validatorName, isTrackLogic (public), namesOf (for storage); imports nothing from snapshot/
    storage.ts                        private to snapshot/: readSnapshotFile, writeText, writeVersions, readDeployedValidators,
                                      readBuildPlutus, deployedAmong, takeFromBuild (+ refsOf, reachable, shapeOf),
                                      blueprintError, snapshotError, fsError
    read.ts                           readVersions, DeployedRecord, readRecord, validatorNameByHash,
                                      buildValidatorNameByHash, promotedAmong, liveHashOf, isPromoted (new)
    write.ts                          RecordUpdate, RecordOutcome, applyRecordUpdate; PreparedMerge, prepareValidatorMerge,
                                      SnapshotRule, DeploySnapshot, PreparedSnapshot, prepareDeploySnapshot
                                      (stageValidator, promoteValidatorVersion and the write* functions become private)
  contracts.ts  plutus-json.ts  paths.ts   unchanged
```

Imports run one way: `context`, `names` ← `storage` ← `read`, `write`;
`write` also imports `bindings`. `run.ts` and `tests/helpers/effect.ts`
take `DeployedScripts` from `context.ts`; `verify` and `build-engine` take
`validatorName` / `isTrackLogic` from `names.ts`.

`RecordUpdate` is the one value every snapshot write goes through,
prepared in resolve, applied by the command where it applies it today
(index):

```ts
type RecordUpdate =
  | { readonly _tag: "Deploy"; readonly prepared: PreparedSnapshot }
  | { readonly _tag: "Merge"; readonly name: string; readonly prepared: PreparedMerge }
  | { readonly _tag: "Track"; readonly as: "staged" | "promoted"; readonly name: string };

type RecordOutcome =
  | { readonly _tag: "Saved"; readonly dir: string }                      // Deploy
  | { readonly _tag: "Merged"; readonly name: string }                    // Merge
  | { readonly _tag: "Tracked"; readonly as: "staged" | "promoted"; readonly name: string }
  | { readonly _tag: "VersionsMissing"; readonly as: "staged" | "promoted"; readonly name: string };

applyRecordUpdate: (env, updates: readonly RecordUpdate[]) =>
  Effect<readonly RecordOutcome[], BlueprintError, DeployedScripts | FileSystem>
```

`BlueprintError` is the error every snapshot write already fails with
(`writeText` maps the platform error through `fsError`).

The contract system prints nothing, as `versions.ts` prints nothing today
(`stageValidator` returns `false` and the caller warns). Each command
renders the outcomes with the lines it prints today: `Deployment scripts
saved to …` / `Staging forever scripts saved to …`, `Added … to
deployed-scripts/<env>/plutus.json`, `Tracked … as staged in
versions.json`, the promoted line, the not-found warning.

## Tasks

1. `contracts/bindings.ts`: move `generateBlueprint`; `build.ts` and the
   snapshot code import it from there.
2. `contracts/snapshot/{context,storage,read,write}.ts` by moving the
   exports above; `versions.ts` deleted; every importer in `cli/` and
   `tests/` (`snapshot.test.ts` included) updated in the same commit. Add
   `isPromoted(env, name)` and replace the two hand-rolled
   `readVersions(…).promoted.includes` checks in `two-stage-upgrade.ts`
   (`logicToStage`, `stageUpgradeProgram`).
3. `RecordUpdate`, `RecordOutcome`, `applyRecordUpdate`, and every writer
   cut over in one commit: `deploy.ts` and `staging-track.ts` at the point
   they call `writeDeploySnapshot` today (after building, before the
   transaction file); `stageUpgradeProgram` and `promoteUpgradeProgram`
   after `signAndWrite`, where they write today. Each renders the
   outcomes with its current lines. The snapshot write functions become
   private; the write cases of `tests/snapshot.test.ts` go through
   `applyRecordUpdate` under `DeployedScriptsTemp`
   (`tests/helpers/effect.ts`) and assert the returned outcomes.

One commit per task.

## Dependency rules added to the index

- `contracts/snapshot/write` is imported only by `deploy/**` and
  `governance/two-stage-upgrade/logic-record`. Until phase 06 splits it,
  `governance/two-stage-upgrade.ts` is the importer in that slot.
- `contracts/snapshot/read` and `contracts/snapshot/names` are imported by
  `contracts/build-engine`, `deploy/**`, `governance/two-stage-upgrade/**`
  (`two-stage-upgrade.ts` until phase 06), `report/verify`.
- `contracts/bindings` is imported only by `contracts/build` and
  `contracts/snapshot/write`.
- `contracts/snapshot/storage` is imported only by `contracts/snapshot/read`
  and `contracts/snapshot/write`.
- `contracts/snapshot/**` and `contracts/bindings` import no `output`
  (the build program and engine keep their build progress lines).
- `report/**` imports no snapshot write; `tx/**` imports nothing from
  `contracts/**`.

## Out of scope

- The generated blueprint modules still load by static `require` in
  `contracts.ts` (recorded deviation in plans/effect/07, task 3).
- `build-engine.ts` (829 lines) keeps its structure; its only change is
  the import path of the snapshot reads.

## Acceptance

This phase moves ownership and APIs only; no artifact changes.

- `versions.ts` gone; no file imports `contracts/snapshot/write` or
  `contracts/snapshot/storage` outside the rules above (with the phase 06
  interim importer).
- `tests/snapshot.test.ts` green with the same written `plutus.json`,
  `versions.json`, `changelog.json` and blueprint contents as before, all
  under `DeployedScriptsTemp`.
- `build --network preview` and `build --network preview --from-deployed`
  run; afterwards `jj diff --stat` shows no change under
  `deployed-scripts/**`, to `plutus-*.json` or to any generated
  `contract_blueprint*.ts`.

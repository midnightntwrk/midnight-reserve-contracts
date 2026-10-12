# Phase 06 — two-stage-upgrade by phase, snapshot updates explicit

`governance/two-stage-upgrade.ts` (827 lines) holds pure state transitions,
transaction steps, the governance authority, the logic record and two
programs, and writes the snapshot itself (`writeValidatorMerge`,
`stageValidator`, `promoteValidatorVersion`).

## Target

```
governance/
  authority.ts                GovernanceAuthority, governanceAuthorityPlan (was withGovernanceAuthority), witness asset names
  two-stage-upgrade/
    state.ts                  UpgradeField, nextStagingState, promotedMainState (pure)
    logic-record.ts           LogicBuild, logicToStage, the RecordUpdates of stage and promote; the only importer of contracts/snapshot/write here
    stage.ts                  StageUpgradeInput, resolve, planStage, stageUpgradeProgram
    promote.ts                PromoteUpgradeInput, resolve, planPromote, promoteUpgradeProgram
contracts/contracts.ts        V2_TRACK_VALIDATORS, V2TrackValidator (beside UPGRADABLE_VALIDATORS; mint-staging-state imports them)
```

Stage and promote already apply phase 09's `RecordUpdate` (`Merge`,
`Track`) after `signAndWrite`. This phase moves where it is built:
`logic-record.ts` owns the construction, and resolve returns it.

## Tasks

1. Pure move into the target files; `two-stage-upgrade.ts` deleted;
   `commands/stage-upgrade.ts` and `commands/promote-upgrade.ts` import
   from `stage.ts` / `promote.ts`; the `RecordUpdate` construction goes to
   `logic-record.ts`. No behaviour change.
2. Port stage: `planStage` from `stageUpgradeStep`,
   `governanceAuthorityPlan` and the fee spend; `buildStageUpgradeTx`
   deleted. A target with a script reference becomes a reference input;
   without, a provided script (as `withTwoStageScript` does today).
3. Port promote: `planPromote`, optional `registerScriptStake(logic)`
   fragment; `buildPromoteUpgradeTx` deleted.

Tests: `cnight-minting`, `mainnet_upgrade_transactions`,
`stage_auth_all`, `snapshot` (record writes).

## Acceptance

- No file under `cli/governance/` over 700 lines.
- `contracts/snapshot/write` imported only from `logic-record.ts` within
  `governance/`.
- Same-id checks for stage and promote; the record tests show the same
  `plutus.json` / `versions.json` writes as before.

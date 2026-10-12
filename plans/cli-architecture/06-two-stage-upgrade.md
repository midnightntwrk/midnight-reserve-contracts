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

## Deviations

Task 1 (pure move):

- `governance/authority.ts` (signer and threshold datums, 37 lines) took the
  governance authority too: `GovernanceAuthority`, `withGovernanceAuthority`,
  the witness asset names, `requiredSignatures` and `resolveAuthority` (the
  reads, logs and registration check both programs share). It is 177 lines
  and one concern, the multisig authority.
- `two-stage-upgrade/state.ts` also holds what both programs share about the
  target: `TwoStageTarget`, `UpgradeInputs`, `outputRef`, `twoStageOutput`
  and `withTwoStageScript`.
- `logic-record.ts` owns the whole record path, so it is the one importer of
  `contracts/snapshot/write`: `prepareLogicCopy` (the `Merge` preparation),
  `stageRecord` and `promoteRecord` (the `RecordUpdate`s) and `applyRecord`
  (apply, then print the outcome lines). The programs keep the order of
  reads and log lines; `stageRecord` is built where the old program built
  its list, `promoteRecord` where it read the staged logic's name.
- The programs have no separate `resolve` yet: that comes with the ports.

Task 2 (stage on plan/compile):

- `planStage` returns `Either<TxPlan, DatumParseError>`: the staging UTxO's
  datum is read raw. The target step is the exported fragment `stageStep`,
  and `state.ts` holds the shared `twoStageStep` / `TwoStageStep`
  (spend, reference, script or script reference, output), so promote reuses
  it. `stage_auth_all` still stages seven targets in one transaction: it
  joins seven `stageStep` fragments and one `governanceAuthorityPlan` into a
  `TxPlan` by hand, as the old test chained `stageUpgradeStep` calls.
- `governanceAuthorityPlan` returns the plan parts the authority owns:
  references (threshold, both forevers, the council main when it applies),
  the witness mints (`planMintWitnesses`), the gov-auth withdrawal and
  `requiredSignatures`. The gov-auth script is provided by the withdrawal,
  so `scripts` carries only the target's. `withGovernanceAuthority`,
  `requiredSignatures` and `withTwoStageScript` stay until promote's port,
  which still uses them.
- `StageUpgradeParams` is `{ field, newHash, networkId }`. `ResolvedStage`
  also carries the `LogicRecord` (`logic-record.ts`'s name for the prepared
  `RecordUpdate[]`, so `stage.ts` does not import `contracts/snapshot/write`
  even for the type). The record is applied where it was: after
  `signAndWrite`.
- `signerFor` still runs first. `deployerWallet` is read after resolve and
  Blaze is built inside `compile`: before, `provider.blazeFor` ran mid-resolve
  (after the logic and record lines), so a DEPLOYER_ADDRESS, aiken.toml or
  Blaze.from failure now surfaces later. Stdout on the success path is
  unchanged.
- The old program's `knownUtxos` equal the plan's spends, references and
  collateral. `buildTx` (old) and `compile` (new) both run the local check
  over them.
- Same-id on the emulator (throwaway, deleted), over the mainnet snapshot
  UTxOs: the old `buildStageUpgradeTx` plus `buildTx` twice as a control,
  then `planStage` plus `compile`; id and CBOR equal, one "Local UPLC test
  passed" per build:
  - reserve Auth via the main authority with a target script reference
    `a6e56a35…`
  - reserve Logic via the staging authority (council main referenced),
    script provided `1a8ed411…`

Task 3 (promote on plan/compile):

- `planPromote` returns `Either<TxPlan, DatumParseError>` (both datums are
  read raw). The optional logic registration is the plan's `registrations`
  (`Option.toArray(registerLogic)`), as the other ports do; there is no
  separate fragment. `PromoteUpgradeParams` is `{ field, networkId,
  registerLogic }`; `ResolvedPromote` carries the `LogicRecord`, built by
  `promoteRecord` where the old program read the staged logic's name.
- Same stdout order, `signerFor` first, and `deployerWallet` after resolve,
  as in task 2.
- `withGovernanceAuthority`, `requiredSignatures` and `withTwoStageScript`
  are deleted with promote's last use. `mintWitnesses` and
  `withdrawThroughLogic` in `tx/scripts.ts` had no caller left (the second
  since phase 05) and are deleted there: the one edit outside the target
  tree, a deletion.
- Same-id on the emulator (throwaway, deleted), over the mainnet snapshot
  UTxOs, as for stage with the old `buildPromoteUpgradeTx`; id and CBOR
  equal, one "Local UPLC test passed" per build, `knownUtxos` equal:
  - reserve Auth via the main authority, script provided `57de8d88…`
  - the same with a target script reference and `registerLogic` (the
    staging gov-auth script, unregistered on the emulator) `ecfa8baa…`

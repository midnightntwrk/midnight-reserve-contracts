# Phase 07 — Deploy family and wallet commands on plan/compile

## Tasks

0. Before the port, its own commit and behaviour change: `deploy.ts`
   completes through `buildTx` with `knownUtxos: [oneShot, collateral]`
   (as `staging-track.ts` does) instead of `completeBuilder`. Expected
   differences, to note in the commit: stdout gains the local UPLC lines
   and a `Transaction built` line per transaction; when the local run
   passes, ex-units come from the local evaluator
   (`makeUplcEvaluator(params, 1.2, 1.2, …)`, 20% over-estimate) instead of
   the provider's, so fees and ids differ from earlier builds; a failing
   validator's traces name it through the blueprint labels. The local
   check reads protocol parameters through `Provider.parameters`, so it
   adds provider calls (no cache; see 00-index "Decisions taken"). The
   deploy tests' validity assertions stay green.
1. `deploy/builders.ts`: `planTwoStageDeployment`,
   `planCnightMintingDeployment`, `planThresholdDeployment`,
   `planStagingForeverDeployment`. `DeployParams` keeps `networkId` and
   `coinsPerUtxoByte` (min-ADA of NFT outputs); `collateral` becomes
   `plan.collateral`.
2. `deploy.ts`: each `DEPLOY_STEPS` entry returns a `TxPlan`; the loop
   calls `compile`. The snapshot is still written after every transaction
   is built and before the transaction file (index). One commit with
   task 1.
3. `staging-track.ts`: `compile`; its derived `knownUtxos` (one-shot,
   collateral) equals today's explicit list. Snapshot order kept as in 2.
4. `wallet/simple-tx.ts`: `planSimpleTx` (`payLovelace` outputs, no
   spends: coin selection funds it, no local check, as today).
   `tests/helpers/effect.ts` funds through `compile(planSimpleTx(…))`.
5. `wallet/mint-tcnight.ts`: `planMintTcnight`. A mint plan has no spends,
   so the local check is skipped by derivation, which is what the comment
   at `mint-tcnight.ts:289` does by hand today; delete the comment.

One commit per task except 1+2.

Out of scope, noted: building every deploy transaction from the same
`GuardedWallet` before any submit could let two steps select the same
wallet UTxO if a one-shot does not cover its own fee. Unverified; if it is
real, the fix is batch-wide reservation in the deploy loop, not in
`TxPlan`.

## Acceptance

- `deploy` with the default components and with `--components` on the
  emulator yields the same transaction ids as before (throwaway check).
- `cli/deploy/` and `cli/wallet/` have no `blaze` parameter and no
  `TxBuilder` import.

## Deviations

- Task 0: `DeploymentSetup.maxTxSize` is removed. `deploy` was its only
  reader, and `buildTx` reads `maxTxSize` from `Provider.parameters`.
- Task 0, observed on the emulator (`deployProgram`, default components
  and a five-component `--components` run): each transaction now prints
  "Testing transaction locally (UPLC)...", "Local UPLC test passed" and
  "Transaction built: <id>". Every local run passed. The ids differ from
  the `completeBuilder` build, as the task says; the build is
  deterministic (two runs gave byte-identical ids and CBOR), so it is the
  baseline for tasks 1+2.
- Tasks 1+2: the collateral UTxO travels in each deployment's inputs
  (`TwoStageStates`, `ThresholdDeployment`, `StagingForeverDeployment`)
  and becomes `plan.collateral`; `DeployParams` keeps `networkId` and
  `coinsPerUtxoByte` only. `StepBody.build` is renamed `plan`.
- Tasks 1+2: `DeploymentSetup` loses `blaze`, `deployer` (a string nothing
  read) and `params.collateral`, and gains `collateral` and `compile`, the
  `CompileOptions` but for `commandName` (the deployer's wallet, change
  address, no metadata, fee padding 0, `DEPLOYER_ONLY`, the blueprint
  contracts for labels), built once in `deploymentSetup`. A step plans
  from `DeployContext`, which omits `compile`. `StagingStep.datum` takes
  only the two signer sets it reads.
- Tasks 1+2: `deploy-staging-track` plans through
  `planStagingForeverDeployment` in the same commit, since the setup no
  longer holds Blaze. Until task 3 it completes through `toTxBuilder` and
  `buildTx` over `provider.blazeFor(setup.compile.wallet)`.
- Tasks 1+2: `registerScriptStake` (`tx/scripts.ts`) has no caller left and
  is deleted. `tests/deploy.test.ts` keeps `completeBuilder` over
  `toTxBuilder` for the size-check test, which needs an explicit
  `maxTxSize` that `compile` reads from the provider.
- Tasks 1+2, same-id check on the emulator (throwaway, deleted): the task 0
  build and the plan + `compile` build from the same seeded state gave the
  same ids and the same CBOR for `deployProgram` with the default
  components (12 transactions, first `0b67e5b1…`) and with `--components
  tech-auth,main-gov,reserve,terms-and-conditions,cnight-minting` (5), and
  for `deployStagingTrackProgram` (all six, and `council` with
  `terms-and-conditions`).
- Task 3: `deployStagingTrackProgram` calls `compile` with the same
  `compileOptions` deploy uses. The derived `knownUtxos` (spends, then
  references, then collateral) is `[oneShot, collateral]`, the list the
  explicit `buildTx` call passed. Same-id on the emulator (throwaway,
  deleted): the previous change's build and the `compile` build gave the
  same ids and CBOR for all six components and for `council` with
  `terms-and-conditions`; each transaction logged one "Local UPLC test
  passed".

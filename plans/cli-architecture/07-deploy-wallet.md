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
   validator's traces name it through the blueprint labels. Protocol
   parameters come from the per-run cache (phase 03), so the local check
   adds no provider calls. The deploy tests' validity assertions stay
   green.
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

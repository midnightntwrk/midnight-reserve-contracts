# Phase 05 — Governance commands on plan/compile

Same port as the phase 04 pilot, one command family per commit. Each port:

- `build*Tx(blaze, inputs, params) => TxBuilder` becomes `plan*(inputs,
  params) => Either<TxPlan, …>`; `params` keeps domain data only
  (`newSigners`, `terms`, `networkId`, …). `changeAddress`, `feePadding`
  and the metadata type move to `CompileOptions`.
- The program keeps its resolve code and logs, builds `CompileOptions`
  (with `expectedWitnesses = witnessCount(signer, plan.requiredSignatures)`)
  and calls `compile` with `wallet: yield* deployerWallet`. It no longer
  touches `Provider.blazeFor`, `knownUtxos` or a hand-summed witness count.
  Its reads move into a `resolve*` function (as `resolveMerge`) that
  returns the plan's inputs and params.
- The emulator tests that called the builder call `toTxBuilder(blaze,
  plan*(…), options)`; assertions unchanged.
- The throwaway same-transaction-id check from phase 04, per command.

## Order

1. `governance/governed-forever.ts` with both callers, `change-terms` and
   `change-federated-ops` (one commit: the shared builder and its callers
   move together). Tests: `change-terms`, `change-federated-ops`,
   `logic-redeemer-v2-wrapping`.
2. `change-multisig` (`change-council`, `change-tech-auth`). Tests:
   `change-multisig`, `logic-redeemer-v2-wrapping`.
3. `migrate-federated-ops`. Test: `migrate_federated_ops`.
4. `run-cnight-mint` (`run-cnight-mint-mainnet`). Test: `run-cnight-mint`.
5. `register-stake` (`register-gov-auth`, `register-cnight-mint-logic`);
   `metadata: none`, as today. Test: `register-stake`.
6. `mint-staging-state`; `coinsPerUtxoByte` comes from
   `Provider.parameters` in resolve and is a plan parameter (min-ADA of the
   staging output).

Files stay single files, ordered resolve → plan → program, up to the
index's 600–700 line guideline. `change-multisig.ts` (about 360 lines
after phase 01) stays one file.

## Acceptance

- No `build*Tx` and no `blaze` parameter left in `cli/governance/`
  outside `two-stage-upgrade.ts`.
- Each family's same-id check passed (noted in its commit message).

## Deviations

- A prerequisite commit comes before the ports. `TxPlan` gains `mints`,
  `registrations`, `collateral` and `requiredSignatures`, and
  `toTxBuilder` applies them in the order the builders use: mints, each
  with `provideScript(policy)`, after scripts; registrations after
  withdrawals; collateral last. `knownUtxos` now includes the collateral,
  as the old callers passed it. `tx/scripts.ts` adds `planMintWitnesses`,
  which returns the mints and the summed `requiredSignatures`; the
  hand-sum in programs goes. The native policy id comes from
  `Script.newNativeScript(native).hash()`, checked equal to
  `native.hash()`. A registration is the bare script in `registrations`,
  so there is no separate fragment for it.

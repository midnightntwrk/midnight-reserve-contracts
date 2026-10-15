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
- The six ports were done in parallel, each in its own jj workspace off
  the prerequisite, then stacked in the order above with no conflicts.
  Their deviations are recorded here in a follow-up commit, not in each
  port commit.
- A `plan*` returns `TxPlan` directly when nothing in it can fail
  (governed-forever, terms, federated-ops, migration, run-cnight-mint,
  register-stake, mint-staging-state). `planMultisigChange` keeps
  `Either`, for the failure on more than 255 signers.
- At first no program gained a "Building transaction..." line, since only
  merge-utxos printed it. Later, at the user's request, `compile` prints
  it once before it builds, so every ported command prints it (deploy and
  deploy-staging-track once per transaction), and merge-utxos no longer
  prints its own. On merge's failure path, a `planMerge` error (first UTxO
  without a datum) now comes before the line, not after it.
- Programs that take `--sign` still call `signerFor` before `resolve*`, so
  a missing key fails before any output.
- `deployerWallet` is now read after resolve, and Blaze is built inside
  `compile`. Before, `provider.blazeFor(yield* deployerWallet)` ran partway
  through resolve, so a DEPLOYER_ADDRESS, aiken.toml or Blaze.from failure
  now surfaces later. The success path is unchanged.
- `*Params` now hold only domain data: governed-forever `{ networkId }`,
  terms `{ terms, networkId }`, federated-ops `{ newCandidates, networkId }`,
  multisig `{ newSigners, networkId }`, migration and run-cnight-mint
  `{ networkId }`, mint-staging-state `{ networkId, coinsPerUtxoByte }`.
  `RegisterCnightMintLogicParams` is deleted.
- mint-staging-state's resolve reads `coinsPerUtxoByte` and
  `collateralPercentage` from `Provider.parameters`. The inputs no longer
  carry `protocolParams`, and the change address is still
  `DeployerAddress.address`.
- register-gov-auth's old builder set no change address and no fee
  padding, so Blaze fell back to the wallet's address and padding `0n`.
  The program now passes those values explicitly, with
  `metadata: Option.none()`.
- run-cnight-mint's forever withdrawal is the first plan withdrawal (its
  script is provided there), followed by `planWithdrawThroughLogic`; the
  plan has `scripts: []`.
- The `knownUtxos` sets are identical in every family. Each plan's
  spends, references and collateral equal what the old program passed.
- Same-id checks on the emulator (throwaways, deleted). Each built the old
  builder plus `buildTx` twice as a control, then the plan plus `compile`;
  the transaction id and CBOR matched in every case:
  - change-terms `3e237646…`
  - change-federated-ops `1601464f…`
  - change-council `9602e5c8…`
  - change-tech-auth `7e4e9cc6…`
  - migrate-federated-ops `56f04529…`
  - run-cnight-mint `10bf241d…`, and `c190d10a…` with mitigation
  - register-gov-auth `57eba7ed…`, which has no local check: no known UTxOs
  - register-cnight-mint-logic `b4bc7c45…`
  - mint-staging-state `c47dd759…`

  Every build that runs the local check logged "Local UPLC test passed".

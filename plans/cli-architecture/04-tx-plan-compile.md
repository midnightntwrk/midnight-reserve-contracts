# Phase 04 — TxPlan, compile, pilot on merge-utxos

A command stops handing Blaze a half-built `TxBuilder` and hands `tx/` a
value instead. `tx/compile.ts` is the only module that turns a plan into a
Blaze transaction.

## Types (`tx/plan.ts`)

Only what the builders use today (`addInput`, `addReferenceInput`,
`provideScript`, `addOutput`, `addMint`, `addWithdrawal`,
`addRegisterStake`, `provideCollateral`, `payLovelace`, `setMetadata`):

```ts
interface TxPlan {
  readonly spends: readonly { utxo: TransactionUnspentOutput; redeemer: Option<PlutusData> }[];
  readonly references: readonly TransactionUnspentOutput[];
  readonly scripts: readonly Script[];               // provided in the witness set
  readonly mints: readonly {
    policy: Script;                                  // Plutus or native
    assets: ReadonlyMap<AssetName, bigint>;
    redeemer: Option<PlutusData>;                    // None for a native policy
  }[];
  readonly outputs: readonly PlannedOutput[];        // TransactionOutput | { payLovelace: Address; lovelace: bigint }
  readonly withdrawals: readonly { rewardAccount: RewardAccount; script: Script; redeemer: PlutusData }[];   // zero amount
  readonly registrations: readonly Script[];         // Conway reg cert with script witness
  readonly collateral: readonly TransactionUnspentOutput[];
  readonly requiredSignatures: number;               // native multisig signatures the plan demands
}

interface CompileOptions {
  readonly commandName: string;
  readonly slotConfig: SlotConfig;                   // for the local evaluator; resolved by the program
  readonly changeAddress: Address;
  readonly feePadding: bigint;
  readonly metadata: Option<string>;                 // CIP-20 type; register-* set none today
  readonly expectedWitnesses: number;                // witnessCount(signer, plan.requiredSignatures), computed by the program
  readonly contracts: readonly { className: string; hash: string }[];  // for labels; empty when no blueprint
}
```

`tx/scripts.ts` keeps its names and returns plan fragments instead of
taking a `TxBuilder`: `mintWitnesses(witnesses, networkId)` → `{ mints,
requiredSignatures }`; `withdrawThroughLogic(logic, mitigation, redeemer,
networkId)` → withdrawals (reward accounts built here) and scripts;
`registerScriptStake(script)` → a registration; `logicRedeemer`
unchanged. `tx/plan.ts` adds `mergePlans` (concatenate each field, sum
`requiredSignatures`).

`compile` takes no `Environment` and no `NetworkId`, so `tx/**` imports
nothing from `config/**`. The slot-config choice (`slotConfigFor`, private
in `complete-tx.ts` today) moves to `config/network-mapping.ts` as
`slotConfigOf(environment)`; programs pass its result.

## `tx/compile.ts`

- `toTxBuilder(blaze, plan, options): TxBuilder` — applies spends,
  references, scripts, mints, outputs, withdrawals, registrations,
  collateral, then change address, metadata, fee padding. Redeemer-bearing
  fields go in the order every builder uses today (spends → mints →
  withdrawals → registrations), so the script data hash is unchanged.
  Exported for the emulator tests.
- `compile(plan, options): Effect<Transaction, TxBuildError |
  ProviderError | ConfigError, Provider | Output>` (the error channel
  `buildTx` has today) — `Provider.blaze` → `toTxBuilder` → local UPLC
  check when `knownUtxos` is non-empty → `complete()` → `sizeAtSubmit`
  against `options.expectedWitnesses`.
- Derived, no longer passed by programs: `knownUtxos = spends ∪
  references ∪ collateral`; labels from `options.contracts` (`compile` no
  longer reads `Blueprint`).
- `buildTx` and `completeBuilder` stay until their last caller moves
  (phase 08 deletes them).

## Tasks

1. `tx/plan.ts`, the `tx/scripts.ts` fragments, `toTxBuilder`, `compile`.
   The old `TxBuilder`-taking helpers stay beside the fragments under
   their current names only until phase 08; the fragments take the names
   `plan*` meanwhile (`planMintWitnesses`, …) and are renamed in 08.
2. Pilot `merge-utxos`: `planMerge(inputs: MergeInputs, params:
   MergeParams): Either<TxPlan, …>` with `MergeParams` reduced to domain
   data (`cnightAssetId`, `networkId`); `mergeUtxosProgram` builds
   `CompileOptions` from its resolved values and calls `compile`;
   `buildMergeTx` deleted. `tests/mainnet_merge_transactions.test.ts` calls
   `toTxBuilder(blaze, planMerge(…), options)`.
3. Edit the plans/effect index guardrail ("exposes its builder … `=>
   TxBuilder`") to say builders are `plan*` functions compiled by
   `tx/compile.ts`, linking this plan.

One commit per task.

## Acceptance

- Throwaway check, run once and deleted: on the emulator, the old
  `buildMergeTx` + `buildTx` and the new `planMerge` + `compile` give the
  same transaction id from the same UTxOs.
- `merge-utxos` build-only run against preview writes the same file shape
  and output lines as before (no submit).
- `tx/compile.ts` imports nothing from `contracts/` or `config/`.

## Deviations

- A move commit comes before task 1. `buildTx` reads `Blueprint` and the
  environment, so it cannot stay in `tx/compile.ts` under the import
  acceptance. Its body becomes `completeChecked(txBuilder, completion)` in
  `tx/compile.ts`, taking the slot configuration and a `contracts` effect.
  `completeChecked` still reads `contracts` inside the local step, so a
  failure there only fails the local check, as before. `buildTx` moves to
  `tx/complete-tx.ts` as a thin wrapper that supplies `slotConfigOf(environment)` and
  the Blueprint's contracts when a Blueprint is provided, and an empty
  list otherwise. `tx/complete-tx.ts` imports `config/` and `contracts/`
  until phase 08 deletes it. `slotConfigFor` is now
  `slotConfigOf(environment)` in `config/network-mapping.ts`; a throwaway
  check confirmed it returns the same configuration for every environment.
  `tx/labels.ts` names the label input `NamedContract`.
- Task 1 ships only what the merge pilot uses, so nothing is dead code.
  `TxPlan` has `spends`, `references`, `scripts`, `outputs`
  (`TransactionOutput` only) and `withdrawals`. `mints`, `registrations`,
  `collateral`, the `payLovelace` output and `requiredSignatures`, with
  their `toTxBuilder` branches, arrive with their first caller in phases
  05 and 07, in the order the table above gives (mints between scripts and
  outputs, registrations after withdrawals, then collateral).
  `planMintWitnesses`, the registration fragment and `mergePlans` wait the
  same way. `planWithdrawThroughLogic` returns only withdrawals. Each
  withdrawal carries its script, which `toTxBuilder` provides, so the
  fragment returns no separate `scripts`.
- `toTxBuilder` takes `Pick<CompileOptions, "changeAddress" | "feePadding"
  | "metadata">`, so emulator tests need not invent a slot configuration,
  a witness count or contracts.
- `compile` requires `Provider | Output | DeployerAddress | Profile`.
  `Provider.blaze` needs the deployer's address and the profile; the types
  are inferred, so `tx/compile.ts` still imports nothing from `config/`.
  `knownUtxos` is the plan's spends followed by its references.
- Merge pilot:
  - The program reads `blueprint.contracts` before `compile` rather than
    inside the local step. It cannot fail there: `contracts` and
    `twoStage` load the same module, and `enumerateContracts` skips any
    class that throws.
  - Blaze is now built inside `compile`, after "Building transaction...",
    not before the contract UTxO lookup. Stdout on the success path is
    unchanged.
  - `MergeParams` keeps only `cnightAssetId` and `networkId`.
  - `tests/mainnet_merge_transactions.test.ts` builds through
    `toTxBuilder(blaze, planMerge(…), …)` with its cases unchanged.
- Acceptance as run:
  - Emulator same-id check (throwaway, deleted): old `buildMergeTx` +
    `buildTx` and `planMerge` + `compile` built the same transaction id
    and the same CBOR from the same UTxOs. All three builds (old twice as
    a control, new once) logged "Local UPLC test passed".
  - Preview: no forever UTxO on the preview chain held cNIGHT and a
    datum. Preview ICS had three cNIGHT UTxOs, none with a datum; the
    other forevers held no cNIGHT. At the user's request, preview
    transaction `c07f78d3…1298` (built through `compile` with an empty
    spend list, submitted with `sign-and-submit`) locked two UTxOs at the
    ICS forever: 2 ADA each, 1,000 and 2,000 cNIGHT, datum `Constr 0 [0, 0]`
    as on the deployed ICS UTxO. The old and new CLI then ran
    `merge-utxos -n preview --validator ics` over `c07f…#0` and `#1`, build
    only, with the same arguments. Stdout was identical except the output
    directory, stderr was identical, and both wrote the same file (tx
    `d2ba1369…2091`). Both passed the local UPLC check. The merge was not
    submitted.

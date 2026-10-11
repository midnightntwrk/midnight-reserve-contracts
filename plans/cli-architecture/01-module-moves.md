# Phase 01 — Module moves

Pure moves: every export keeps its name, signature and behaviour; only its
module changes. Each step deletes the old module (or the moved exports) in
the same commit and updates every importer in `cli/` and `tests/`. No
re-exports.

## Tasks

1. `cli/signing/`
   - `chain/sign-and-submit.ts`, `chain/combine-signatures.ts`,
     `chain/tx-file.ts` → `signing/` (same file names).
   - From `chain/transaction.ts` → `signing/signer.ts`: `publicKeyOf`,
     `signTransaction`, `attachWitnesses`, `KEY_GROUP_LABELS`,
     `SIGNING_GROUPS`, `Signer`, `UNSIGNED`, `signerFor`, `DEPLOYER_ONLY`,
     `witnessCount`, `signAndWrite`.
2. `cli/tx/`
   - `chain/complete-tx.ts` → `tx/compile.ts` (exports unchanged until
     phase 04).
   - `chain/validator-labels.ts` → `tx/labels.ts`.
   - From `chain/transaction.ts` → `tx/scripts.ts`: `logicRedeemer`,
     `createNativeMultisigScript`, `mintWitnesses`, `withdrawThroughLogic`,
     `registerScriptStake`, `createRewardAccount`, `createTxMetadata`.
3. Datum and UTxO helpers
   - From `chain/transaction.ts` → `datum/inline.ts`: `inlineDatum`,
     `decodeDatum`, `decodeInlineDatum`.
   - From `chain/transaction.ts` → `chain/utxo.ts`: `refOf`,
     `findUtxoByTxRef`. `chain/transaction.ts` now holds only
     `createUpgradeState`; task 4 moves it and deletes the file.
4. `chain/governance-provider.ts` split by owner, then deleted with
   `chain/transaction.ts`:
   - → `governance/two-stage.ts`: `MAIN_TOKEN_HEX`, `STAGING_TOKEN_HEX`,
     `findMainUtxo`, `upgradeScripts`, `twoStageUtxos`, `UpgradeState`,
     `rawUpgradeStateAt`, `upgradeStateAt`; plus `createUpgradeState` (from
     `chain/transaction.ts`) and `twoStageLogic` (from
     `governance/change-multisig.ts`, which `change-terms` and
     `change-federated-ops` import across features today).
   - → `governance/authority.ts`: `signersAt`, `thresholdAt`.
   - → `chain/utxo.ts`: `ContractUtxos`, `contractUtxos`, `deployerUtxo`.
   - → `chain/registration.ts`: `registrationOnChain`,
     `rewardAccountRegistered`, `ensureRegistered`.
   - `tests/governance-provider.test.ts` splits along the same lines
     (`two-stage.test.ts`, `authority.test.ts`, `registration.test.ts`),
     each case unchanged.

One commit per task. `tests/` importers to update: about 20 files
(`MAIN_TOKEN_HEX`/`STAGING_TOKEN_HEX` alone in 11).

## Acceptance

- `cli/chain/` holds only `provider.ts`, `blockfrost.ts`, `submit.ts`,
  `utxo.ts`, `registration.ts`.
- `just fmt && just build && just check && bun test` green after each
  commit; test count unchanged.
- No module in `cli/` re-exports a moved symbol.

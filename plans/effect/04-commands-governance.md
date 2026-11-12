# Phase 04 — Governance transaction builders

Goal: the commands that build (and optionally submit) governance
transactions, one commit each; shared code in `lib/change-multisig.ts`
moves first.

| Step | Command(s) | Lines |
|---|---|---|
| 1 | `lib/change-multisig.ts` | 444 |
| 2 | `change-council`, `change-tech-auth`, `change-federated-ops` | 707 |
| 3 | `change-terms` | 510 |
| 4 | `register-gov-auth`, `register-cnight-mint-logic` | 238 |
| 5 | `mint-staging-state` | 410 |
| 6 | `stage-upgrade`, `promote-upgrade` | 1000 |
| 7 | `migrate-federated-ops` | 341 |
| 8 | `merge-utxos` | 335 |

Shared shape: `Effect.gen` that resolves UTxOs (`Provider`), builds with
Blaze (`Effect.tryPromise` → `TxBuildError`), completes (`complete-tx`),
then either writes the tx file or submits (`submit.ts`). `--dry-run`
paths become `Effect.when`.

## Builder extraction (the testable seam)

Today only `buildMultisigChangeTx` (`lib/change-multisig.ts`) is an
exported builder; `stage-upgrade`, `promote-upgrade` and `merge-utxos`
build their transaction inside `handler(argv)`, so no test can call it and
the emulator tests hand-mirror the logic. As each step lands, split the
command into:

- `lib/<name>.ts`: `build<Name>Tx(blaze, inputs, params): Either<TxBuilder, InputParseError | DatumParseError | ...>`
  — pure over already-resolved UTxOs and datums, no provider, no I/O.
  (As built: `Either`, not `Effect`, because the builder performs no
  effect; the file is `lib/<name>.ts` and also holds `<name>Program`.)
  Step 1 keeps `buildMultisigChangeTx`; step 6 adds `buildStageUpgradeTx`
  and `buildPromoteUpgradeTx` (both two-stage fields, both authorities);
  step 8 adds `buildMergeTx`.
- `program(argv)`: resolve inputs through `Provider`, call the builder,
  complete, write or submit.

The tests that today hand-build these transactions switch to the builder
in the same commit (see phase 06 step 4): `mainnet_upgrade_transactions`
(stage/promote against the mainnet snapshot), `tech_council_upgrade`,
`stage_auth_all`, `mainnet_merge_transactions`,
`change-council-duplicate-signers`, `change-terms-cli`,
`migrate_federated_ops`. A test that still hand-builds after its command's
step is a defect of that step.
Record (test cleanup, after phase 08): `tech_council_upgrade` is gone, its
states asserted in `mainnet_upgrade_transactions`;
`change-council-duplicate-signers` and `change_auth_member` merged into
`tests/change-multisig.test.ts`.

The `[datum-versions] logic_round … falling back` warning seen in
`bun test` today becomes a structured `Effect.logWarning` with fields and
is asserted once in a test.

## Follow-up (after the two 2026-09-25 reviews)
Fixed in the phase 04 follow-up commits `lsvptunq`, `yywpvykr`, `umrssqww`,
`xvnolmzu`, `kspkwtuo`: the datum-versions fallback
warning for the secondary authorities (output drift) through one
structured helper with a test; change-federated-ops' migrate-first rule
as `PreconditionFailed`; the register builders in `lib/register-stake.ts`
with `expectValidTransaction` tests; negative twins for change-tech-auth
and stage_auth_all; `logic-redeemer-v2-wrapping.test.ts` on the builders;
the lint gate widened to the ported commands and `lib/*.ts`; one shared
witness-requirements helper; non-empty signer arrays; `UtxoNotFound` as a
union; dead exports removed; tests no longer mutate `process.env`.
As built: `ConfigLive(environment, env)` takes the env record (CliLive passes
`process.env`, tests pass literals) and exposes `optionalEnvVar`; the
fallback warning is `codecFor` in datum-versions, printed through Output;
`Signers = NonEmptyReadonlyArray<Signer>`; the lint gate's strict block covers
`cli-yargs/lib/**` and every command that runs through `runCommand`, with the
legacy sections under a block `eslint-disable` that goes with them.
Also as built: the stage and promote builders and programs live together in
`lib/two-stage-upgrade.ts` (one file, shared steps and authority), and the
register builders in `lib/register-stake.ts`; `buildRegisterGovAuthTx(blaze,
govAuth, stagingGovAuth)` takes the two scripts directly because it has no
params. change-council reads the tech-auth signers raw (`decodeSigners`, as
before the port) and the two-stage programs read both authorities raw; only
the codec-selected reads (change-tech-auth's council, change-terms and
change-federated-ops' two authorities) go through `codecFor`.
`tests/stage_auth_all.test.ts` composes `stageUpgradeStep` and
`governanceAuthority` for one transaction over seven validators, since
`buildStageUpgradeTx` covers one target; its twin pins the generic
"Validator returned false" until the phase 06 twins name the failing
script. `encodeMultisigState` and `encodeRedeemerMap` stay over
`readonly Signer[]`: they are CBOR encoders (tests encode arbitrary lists,
including 256 duplicates), and the non-empty rule holds where signer sets
enter — `parseSignerPairs`, `parseSignerList`, `decodeSigners` and the
builder inputs. Program-level tests with captured
output exist for change-council, change-tech-auth (with the council fallback
warning), change-terms (`tests/governance-programs.test.ts`),
change-federated-ops (precondition), stage/promote, migrate, merge,
mint-staging-state and the register commands. Missing
negative twins (promote on a stale staging round, merge dropping cNIGHT at
the validator, register twins) are phase 06 work.
Deferred to phase 09: the `use-build` handler overrides become an explicit
blueprint-source parameter. Deferred to phase 07: snapshot writes through
a service, `signAndWrite` unification, a shared forever-update builder.

## Acceptance
- Emulator tests for each command (`tests/change-*.test.ts`,
  `stage_*`, `promote`, `migrate_*`) pass through the phase 06 runtime
  helper; the program tests assert the captured output lines and the
  written file (the governance goldens are the preview live-check
  references, not test fixtures).

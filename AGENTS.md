# AGENTS.md

Midnight governance smart contracts on Cardano (Aiken validators + TypeScript CLI).

## Pre-Commit (Required)

```bash
just fmt && just build && just check && just test
```

## Critical Guardrails

- **No `sign-and-submit` or `combine-signatures` without asking** - submits real transactions to the network
- **No Aiken changes without explicit instruction** - code holds billions in value
- **No pushing** - commit only, the user pushes

## Mainnet Aiken Files

Files that existed at commit ca38d87 (the audited commit) and compile into a script deployed on mainnet (`deployed-scripts/mainnet/plutus.json`) are **immutable**. Never edit them:

- `validators/`: `cnight_generates_dust.ak`, `gov_auth.ak`, `illiquid_circulation_supply.ak`, `permissioned.ak`, `reserve.ak`, `terms_and_conditions.ak`, `thresholds.ak`
- `lib/`: `auth/script.ak`, `auth/types.ak`, `forever/script.ak`, `forever/types.ak`, `logic/script.ak`, `logic/types.ak`, `multisig/script.ak`, `multisig/types.ak`, `upgradable/two-stage-upgrade.ak`, `upgradable/types.ak`, `utils.ak`

**Exception:** `lib/auth/staging.ak` is audited but may be edited.

Files from ca38d87 that never ran on mainnet may be edited: `validators/committee_bridge.ak`, `lib/bridge/*.ak`, `lib/logic/next_version.ak`, `validators/test_cnight_no_audit.ak` and the `*.test.ak` files. The audit report, with the list of audited files, is `docs/audits/2026-01-08-txpipe-upgradable-contracts.pdf`.

- The `_v2` suffix is used only where an immutable original of the same name exists (e.g. `validators/reserve_v2.ak` next to `validators/reserve.ak`); new modules get plain names (e.g. `lib/logic/reserve.ak`)
- `lib/logic/types.ak` is immutable — new types go in `lib/logic/types_v2.ak`
- `validators/validator_types.ak` may be updated in place: its `z_*` validators always fail and only export types to the blueprint for off-chain code; nothing deployed uses them
- Post-audit files (`validators/staging_*.ak`, `lib/forever/staging.ak`) are freely editable

## Code Style

- Straight-line code; inline over one-use helpers; idiomatic for the language. Follow the patterns already in the repo.
- Remove code your change leaves unused.
- Dependencies: `vp add <package>` without a version; never edit versions in `package.json` by hand.
- TypeScript errors are `Data.TaggedError` classes in `cli/errors.ts`, never `throw`; the CLI formats them.
- Aiken contract code:
  - The stdlib only for types, constructors and the `to_dict |> to_pairs` exact-value pattern; everything else through `lib/utils.ak`, `lib/utils_v2.ak` or builtins. Tests may use any stdlib helper.
  - Check values by exact match on the value as it is, never by adjusting it first.
  - One transaction shape per redeemer.
  - Short traces: a trace only has to say which `expect` failed, and a unique `expect` needs none (the verbose trace already points at it). Tests show why it failed.

## Reference Projects

Architecture patterns derived from:
- [Blaze Cardano](https://github.com/butaneprotocol/blaze-cardano) - Transaction construction SDK
- [Aiken stdlib](https://github.com/aiken-lang/stdlib) - On-chain patterns

## Docs and Plans

Documentation lives in `docs/`, implementation plans in `plans/`; nowhere else.

- [CLI architecture](docs/architecture/cli.md) - flow, services, contract sources, record, layout, dependency rules, tests
- [Contracts architecture](docs/architecture/contracts.md) - component pattern, upgrade lifecycle, audit map, hash pinning, known issues
- [Multisig](docs/architecture/multisig.md) - N-of-M authorization through a native-script mint
- [Testing architecture](docs/architecture/testing.md) - test layers, rules, what exists today
- [Live deployment runbook](docs/governance/runbook.md)
- [docs/governance/](docs/governance/) - validator constraints, transactions, upgrade flow
- [docs/transactions/](docs/transactions/) - transaction diagrams for staking, registration and reserve v2

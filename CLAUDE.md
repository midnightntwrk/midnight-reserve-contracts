# CLAUDE.md

Midnight governance smart contracts on Cardano (Aiken validators + TypeScript CLI).

## Pre-Commit (Required)

```bash
just fmt && just build && just check && vp test
```

## VCS

Use `jj` for all version control, not `git`.

```bash
jj log --limit 5  # Check existing style first
jj describe -m "Add feature X"  # Match project style
```

## Critical Guardrails

- **No `sign-and-submit` or `combine-signatures` without asking** - submits real transactions to the network
- **No Aiken changes without explicit instruction** - code holds billions in value
- **No `jj git push`** - commit only, user pushes

## Audited Aiken Files

Files that existed at commit ca38d87 (the audited commit) are **immutable**. Never edit them. **Exception:** `lib/auth/staging.ak` is the only audited staging file but is allowed to be edited.

- The `_v2` suffix is used only where an audited original of the same name exists (e.g. `validators/reserve_v2.ak` next to `validators/reserve.ak`); new modules get plain names (e.g. `lib/logic/reserve.ak`)
- `lib/logic/types.ak` is audited — new types go in `lib/logic/types_v2.ak`
- Original `.ak` files must stay unchanged (except `lib/auth/staging.ak`)
- Post-audit files (`validators/staging_*.ak`, `lib/forever/staging.ak`) are freely editable

## Aiken v1.1.21 Gotchas

- **Cannot use concrete types in pub fn signatures when callers pass Data** — `redeemer: LogicRedeemer` silently fails (exit 1, no error output). Use `redeemer: Redeemer` (=Data) + `expect` cast inside the function body instead.
- **Treats unused imports as errors** — but outputs NO error message. If build silently fails, check for unused imports first.

## Reference Projects

Architecture patterns derived from:
- [Blaze Cardano](https://github.com/butaneprotocol/blaze-cardano) - Transaction construction SDK
- [Aiken stdlib](https://github.com/aiken-lang/stdlib) - On-chain patterns

## Additional Docs

- [CLI architecture](docs/architecture/cli.md) - flow, services, contract sources, record, layout, dependency rules, tests
- [Contracts architecture](docs/architecture/contracts.md) - component pattern, upgrade lifecycle, audit map, hash pinning, known issues
- [Testing architecture](docs/architecture/testing.md) - test layers, rules, what exists today
- [Live deployment runbook](docs/governance/runbook.md)
- [docs/governance/](docs/governance/) - validator constraints, transactions, upgrade flow

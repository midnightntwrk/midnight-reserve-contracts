# AGENTS.md

Midnight governance smart contracts on Cardano (Aiken validators + TypeScript CLI).

## Pre-Commit (Required)

```bash
just fmt && just build && just check && bun test
```

## Commit Style

```bash
git log --oneline -5  # Check existing style first
git commit -m "Add feature X"  # Match project style, no Co-Authored-By
```

## Critical Guardrails

- **No `sign-and-submit` or `combine-signatures` without asking** - submits real transactions to the network
- **No Aiken changes without explicit instruction** - code holds billions in value
- **No `git push`** - commit only, user pushes

## Reference Projects

Architecture patterns derived from:
- [Blaze Cardano](https://github.com/butaneprotocol/blaze-cardano) - Transaction construction SDK
- [Aiken stdlib](https://github.com/aiken-lang/stdlib) - On-chain patterns

## Additional Docs

- [Architecture & Workspace Structure](.claude/docs/architecture.md)
- [Code Conventions](.claude/docs/code-conventions.md)
- [Testing](.claude/docs/testing.md)
- [SPEC.md](SPEC.md) - detailed architecture context

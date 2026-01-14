# AGENTS.md

## Build Commands

```bash
just build   # Full build with blueprint generation (defaults: env=default, verbosity=verbose)
just check   # Aiken fmt + check + on-chain tests
bun test     # Emulator/integration tests (requires build first)
```

Run `just check` and `bun test` before every commit. Always `just build` before `bun test`.

## Commit Style

```bash
git log --oneline -5  # Check existing style first
git commit -m "feat: add feature X"  # Match project style, no Co-Authored-By
```

Never add Co-Authored-By lines to commits.

## Dependencies

```bash
bun add <package>      # No version - let bun pick
bun remove <package>
```

Never edit package.json by hand for dependencies.

## Code Conventions

**Aiken (validators/, lib/):**
- Two-space indents, snake_case identifiers
- Numbered spec tags (e.g. `(RF-1)`) anchored in `spec/validators.md`
- Promote shared logic into `lib/<domain>` and import explicitly

**TypeScript (cli/, tests/):**
- camelCase, `const` by default, ES module syntax
- Run `bun run lint` before pushing

## Testing Guidelines

- Pair every validator change with a `*.test.ak` case
- Mark negative paths with `fail` to codify invariants
- **Run `just build` before `bun test`** - emulator tests depend on one-shot hashes from local build
- Use Blaze emulator specs (`bun test`) for cross-contract flows
- After hash updates, regenerate `plutus.json` and `contract_blueprint.ts`

## Critical Guardrails

- **No `sign-and-submit` CLI command without asking** - submits real transactions to the network
- **Only touch Aiken code (validators/, lib/) with explicit instructions** - this code on-chain is holding very large financial value
- **No git push** - commit only, user pushes

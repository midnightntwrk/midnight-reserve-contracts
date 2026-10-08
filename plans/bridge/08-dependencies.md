# Phase 08 — Dependency audit and update (everything except Aiken)

Goal: every Bun dependency current within its supported line, no known
advisories, the toolchain pinned by `bun.lock`; the Aiken compiler and
`aiken.toml` dependencies stay exactly as they are (audited bytecode).

## Tasks

### 1. Audit
- `bun outdated`, `bun audit`, `bun pm ls --all | wc -l` before and after.
- Record the starting table in the commit message, not in a file.
- Licenses: `bunx license-checker-rfc --summary`; anything not
  MIT/Apache-2.0/BSD/ISC/MPL-2.0 is listed in the commit message.

### 2. Patch and minor updates (one commit)
`bun update` for everything whose `Update` column moves without a major:
`yargs`, `@blaze-cardano/data`, `@blaze-cardano/emulator` (0.4.x),
`@blaze-cardano/sdk` (0.2.x), `@types/bun`, `@typescript-eslint/*`, `cbor`,
`eslint` 9.x, `globals`, `prettier`. Gate: `just fmt && just build && just
check && bun test`. Prettier may reformat; `just fmt` output is part of the
same commit.

### 3. Blaze majors (one commit, together)
`@blaze-cardano/{blueprint,emulator,query,sdk,uplc,vm}` to the latest line
as one set; they share `@blaze-cardano/core`. Then:
- `bunx @blaze-cardano/blueprint@<new> plutus-default.json -o
  contract_blueprint_default.ts` and diff against the committed file. A
  changed generator output means every `contract_blueprint_<env>.ts` and
  `deployed-scripts/*/contract_blueprint.ts` is regenerated in this commit
  (the `Justfile` pins `@0.8.2` in `use-env`: bump it).
- `makeUplcEvaluator` signature and `Emulator` constructor options are
  the known breaking surfaces (`cli-yargs/lib/complete-tx.ts`,
  `tests/**`).
- The bridge VM test (`tests/bridge/*.test.ts`) is the smoke test for the
  evaluator.

### 4. Tooling majors (one commit each, or skip with a reason)
- `eslint` 10: flat config already in use; check `@typescript-eslint`
  peer range first.
- `typescript` 7: run `bun run check`; if the Go compiler rejects the
  repo's `tsconfig.json` options, stay on 5.9 and note it.
- `toml` 5: `cli-yargs/lib/build-engine.ts` and `config.ts` parse
  `aiken.toml`; compare parsed output before and after on all 8 profiles.

### 5. Not touched
- `aiken` binary, `aiken.toml` `[[dependencies]]`, `aiken.lock`.
- `deployed-scripts/*/plutus.json`.

## Acceptance
- `bun outdated` shows only entries with a written reason to hold.
- `bun audit` clean.
- Gate green at every commit; `plutus-default.json` hashes unchanged by
  this phase (no Aiken input changed).

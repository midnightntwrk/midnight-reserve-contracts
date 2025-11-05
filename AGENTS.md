# Repository Guidelines

## Project Structure & Module Organization
- `validators/*.ak` host on-chain entry points; pair new scripts with matching `*.test.ak` files to keep `build_contracts.sh` ordering valid.
- Shared helpers live in `lib/<domain>`; extend the closest package instead of adding new roots.
- Emulator suites live in `tests/*.test.ts`; regenerate `contract_blueprint.ts` when `plutus.json` changes.
- Deployment artefacts land in `deployments/<network>/`; inspect generated CBOR before committing.

## Build, Test, and Development Commands
- `just build preview verbose` compiles validators, updates hashes, and refreshes `contract_blueprint.ts`.
- `./build_contracts.sh preprod compact` runs the same pipeline with custom trace levels.
- `just check verbose` wraps `aiken check -S` plus on-chain tests; run before every commit or PR.
- `bun test` (or `bun test tests/update_gov.test.ts`) executes Blaze suites; keep the blueprint current so script IDs match.
- `just deploy preview` rebuilds and runs `bun run index.ts`; export `BLOCKFROST_<NETWORK>_API_KEY` first.

## Coding Style & Naming Conventions
- Aiken modules use two-space indents, snake_case identifiers, and numbered spec tags (e.g. `(RF-1)`); keep every new assertion anchored in `Spec.md`.
- Promote shared logic into `lib/<domain>` and import explicitly; avoid duplicating magic constants across validators.
- TypeScript keeps `camelCase`, `const` by default, and ES module syntax; run `bun run lint` before pushing.

## Testing Guidelines
- Pair every validator change with a `*.test.ak` case; mark negative paths with `fail` to codify invariants.
- Use Blaze emulator specs (`bun test`) for cross-contract flows and UTxO wiring.
- After hash updates, regenerate `plutus.json` and `contract_blueprint.ts`, then refresh hard-coded IDs in tests.
- Attach `just check` and `bun test` evidence in PRs; failing suites block merges.

## Specification & Inline Commentary
- Keep inline validator comments aligned with `Spec.md`; each `(TAG-#)` covers a single statement and is mirrored when behaviour changes.
- **Do:** keep helper tags unique and descriptive, separate Minting/Setup and Operational updates, and restate constraints per validator instead of referencing substitutions.
- **Don't:** use ranges like `TS-1..TS-8`, say “same constraints,” or rely on vague notes such as “touch `cnight_policy`.”

## Commit & Pull Request Guidelines
- Commits follow the conventional prefixes already in history (`chore:`, `fix:`, `feat:`) and stay focused on single concerns.
- Name branches `handle/topic` (e.g. `feature/threshold-migration`) and avoid force-pushing once review begins.
- PRs summarise changes, link issues, list commands, and include screenshots or CBOR diffs when artefacts change.
- Add Apache 2.0 SPDX headers to new files and confirm the Midnight CLA is signed before requesting review.

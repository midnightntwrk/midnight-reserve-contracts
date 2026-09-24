# Phase 07 — Cleanup and the `@effect/cli` decision

## Tasks
1. Widen the lint gate (phase 01 step 5) to all of `cli-yargs/**`:
   `ThrowStatement` banned, bare `CatchClause` banned, `process.exit`
   only in `index.ts` and `run.ts`. Fix the remainder.
2. Remove the Promise/throw exports left for compatibility; remove
   `TransactionBuildError` in favour of `TxBuildError`.
3. Structured logs: `Effect.Logger` with a pretty console layer for
   humans and `--log-format json` for CI.
4. `@effect/cli` go/no-go: prototype `info` and `deploy` argument parsing
   with `@effect/cli`; keep yargs unless help output, completions and
   option validation are at least as good and the diff is under 300
   lines. Record the decision in the commit message.
5. Update `.claude/docs/code-conventions.md`: errors, services, how to add
   a command.

## Acceptance
- `grep -rc "throw new Error\|catch {" cli-yargs | grep -v ':0'` empty.
- All 8 profiles: `bun cli-yargs/index.ts info -n <env> --offline` (or
  the nearest read-only command) runs to completion.

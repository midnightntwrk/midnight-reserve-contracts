# Effect migration plan — index

Goal: the CLI (`cli-yargs/`, 24 lib modules, 25 commands, 14.4k lines) and
the tests (`tests/`, 33 files) run on [Effect](https://effect.website)
3.x: every failure is a typed, tagged error in the `E` channel; no
`throw new Error` outside defects; no bare `catch {}`; provider, config,
blueprint and output are services provided by layers; retries, timeouts and
logging come from the runtime, not hand-rolled loops.

Starting point (2026-09-24): 272 `throw new Error`, 50 `try`, 28 bare
`catch {}`, 5 `process.exit`, one error class (`TransactionBuildError`).
Errors are strings; callers cannot tell "UTxO not found" from "Blockfrost
down". `~/.claude/skills/coding-standards` already prefers Effect when a
codebase uses it, `Result` unions otherwise; this plan moves the repo into
the first case.

Blaze stays Promise-based. It is wrapped once, in adapters, with
`Effect.tryPromise` and translated into tagged errors there. Aiken is not
touched by any phase.

| Phase | File | Delivers | Depends on |
|---|---|---|---|
| 01 | [01-foundation.md](01-foundation.md) | `effect`, `@effect/platform-bun`; error taxonomy; `Config`, `Blueprint`, `Provider`, `Output` services; `runCommand` bridge for yargs handlers; lint gate | bridge Plan 08 (dependency baseline) |
| 02 | [02-lib-adapters.md](02-lib-adapters.md) | every `cli-yargs/lib/*` module returns `Effect`; retries and timeouts via `Schedule`; parsers via Effect Schema | 01 |
| 03 | [03-commands-read.md](03-commands-read.md) | `info`, `verify`, `generate-key`, `build`, `build-from-deployed`, `dust-participants`, `simple-tx` | 02 |
| 04 | [04-commands-governance.md](04-commands-governance.md) | `change-*`, `stage-upgrade`, `promote-upgrade`, `migrate-federated-ops`, `merge-utxos`, `mint-staging-state`, `register-*` | 03 |
| 05 | [05-commands-deploy-submit.md](05-commands-deploy-submit.md) | `deploy*`, `mint-tcnight`, `run-cnight-mint-mainnet`, `sign-and-submit`, `combine-signatures` | 04 |
| 06 | [06-tests.md](06-tests.md) | `tests/helpers` as layers (`EmulatorLive`); every test runs through one runtime helper; emulator tests port | 02 (helpers), 03–05 (command tests) |
| 07 | [07-cleanup.md](07-cleanup.md) | zero `throw`/bare `catch` in `cli-yargs`; `process.exit` only in `index.ts`; `@effect/cli` go/no-go | 05, 06 |

Phases 03–05 are one commit per command. Phase 06 runs alongside 03–05:
a command's test moves in the same commit as the command.

## Sequencing with the bridge plans

Bridge Plan 06 adds `bridge-*` commands. If Effect phase 01 has landed,
write them in Effect from the start (they are new code, no port). If not,
write them in the current style and list them in phase 04 here.

## Guardrails for every phase

- `just fmt && just build && just check && bun test` green and one `jj`
  commit per step; no push.
- No `sign-and-submit` / `combine-signatures` runs against a network.
- Behaviour-preserving: a command prints the same output and writes the
  same files before and after its port. Golden outputs are captured in the
  emulator tests before the port (phase 06 step 1).
- `Effect.runPromise` appears in exactly two places: `cli-yargs/index.ts`
  (via `runCommand`) and `tests/helpers/effect.ts`.
- Errors carry data, not prose: `new UtxoNotFound({ address, asset })`, and
  the message is rendered once, in `Output`.

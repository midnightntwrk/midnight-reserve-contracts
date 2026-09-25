# Effect migration plan — index

Goal: the CLI (`cli/`, `cli-yargs/` until plan 09 task 0; 24 lib modules, 25 commands, 14.4k lines at the start) and
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
| 02 | [02-lib-adapters.md](02-lib-adapters.md) | every CLI lib module returns `Effect`; retries and timeouts via `Schedule`; parsers via Effect Schema | 01 |
| 03 | [03-commands-read.md](03-commands-read.md) | `info`, `verify`, `generate-key`, `build`, `build-from-deployed`, `dust-participants`, `simple-tx` | 02 |
| 04 | [04-commands-governance.md](04-commands-governance.md) | `change-*`, `stage-upgrade`, `promote-upgrade`, `migrate-federated-ops`, `merge-utxos`, `mint-staging-state`, `register-*` | 03 |
| 08 | [08-platform-native.md](08-platform-native.md) | `@effect/platform(-bun)` back; FileSystem, Command, HttpClient, Console, ConfigProvider, Schema across the lib; `Provider.use` timeout and `retryable` classification; structured `Effect.logWarning` | 04 |
| 09 | [09-effect-cli.md](09-effect-cli.md) | task 0 (2026-09-25 restructure): `cli-yargs/` → `cli/` domain folders, two unused commands deleted, `sign-and-submit`/`combine-signatures` ported; then yargs replaced by `@effect/cli`, programs re-hosted with their input parsed at the boundary, `BunRuntime.runMain` | 08 |
| 05 | [05-commands-deploy-submit.md](05-commands-deploy-submit.md) | the deploy family (`deploy`, `deploy-staging-track`, `mint-tcnight`), written on the phase 09 layer | 09 |
| 06 | [06-tests.md](06-tests.md) | `tests/helpers` as layers (`EmulatorLive`); tests test functions (builders, lib), never a command program (done 2026-09-26; the refusal asserts moved to fields with 07 task 3c) | 02 (helpers), 03–05 (command tests) |
| 07 | [07-cleanup.md](07-cleanup.md) | zero `throw`/`try` in `cli`, enforced by the lint gate; no `process.exit` in `cli/` (runMain exits with the teardown's code); keys checked at the boundary; refusals carry data (done 2026-09-26; the mainnet `versions.json` edit stays with the operator) | 05, 06 |

Order of execution after 2026-09-25: 04 (done; follow-up landed as
`lsvptunq..kspkwtuo`, conformance fixes after) → 08 →
09 (done, three review rounds) → 05 (done: the deploy family on
Effect, the pre-Effect surface gone, the snapshot rule) → 06 (done) → 07 (done 2026-09-26). Phases 08 and 09 were inserted after the phase 04
reviews found that phase 02 had wrapped Node/Bun primitives in
`Effect.try` instead of using the platform, and that the `@effect/platform`
packages removed in the phase 01 follow-up were never brought back. The
decision recorded in 09 is Effect-first: `@effect/cli` replaces yargs; the
phase 07 go/no-go is closed.

Phases 03–05 are one commit per command. Phase 06 runs alongside 03–05:
a command's test moves in the same commit as the command.

## Sequencing with the bridge plans

Decision 2026-09-24: the whole Effect migration (01–07) lands before bridge
Plan 06. The `bridge-*` commands are then written in Effect from the start
and are not part of phase 04. Bridge Plan 08 (dependency audit) runs
first, as the dependency baseline.

Decision 2026-09-25 (replaces the 2026-09-24 `bridge-deploy` command):
there is one deploy command. The bridge is two new `DEPLOY_STEPS`
entries in `cli/deploy/deploy.ts`, the components `committee-bridge`
and `committee-bridge-threshold`, outside the default set: no
`--components` builds the twelve governance transactions, and the bridge
is built only when named. See bridge Plan 06 task 1.

## Guardrails for every phase

- Effect-native at the edges: files through `FileSystem`, processes
  through `Command`, HTTP through `HttpClient`, plain output through
  `Console`, env through `ConfigProvider`. `Effect.try` around a
  synchronous Node or Bun API is a smell, not a port. `Effect.tryPromise`
  wraps Blaze and nothing else.
- A deviation from a plan is recorded in the commit that makes it and in
  the plan file it deviates from, in the same commit. A deferral names the
  phase that picks it up.

- `just fmt && just build && just check && bun test` green and one `jj`
  commit per step; no push.
- No `sign-and-submit` / `combine-signatures` runs against a network.
- Behaviour-preserving: a command prints the same output and writes the
  same files before and after its port. Golden outputs are captured in the
  emulator tests before the port (phase 06 step 1).
- The CLI runs through `BunRuntime.runMain` in `cli/index.ts` (phase 09);
  `Effect.runPromise` appears only in `tests/helpers/effect.ts` and
  `tests/effect-output.test.ts`.
- Errors carry data, not prose: `new UtxoNotFound({ address, asset })`, and
  the message is rendered once, in `Output`.
- Tests exercise CLI library functions or Aiken, never the binary and
  never a command program (the whole command is manual QA, user decision
  2026-09-26). Every
  command that builds a transaction exposes its builder from
  its `cli/` domain module as `(resolved inputs, params) => TxBuilder`; the
  emulator tests call that builder and let `expectValidTransaction` cover
  the CLI function and the validator in one assertion. Hand-built
  transactions in tests are replaced as each builder lands (phases 04–06).

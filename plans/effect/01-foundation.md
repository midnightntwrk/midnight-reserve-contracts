# Phase 01 — Foundation

Goal: the runtime, the error taxonomy and the services every later phase
plugs into; nothing user-visible changes.

Note (2026-09-25): paths under `cli-yargs/` moved to `cli/<domain>/`
(plan 09 task 0). `ConfigLive` is `SettingsLive` (plan 08 task 7).
`createProvider` was removed (plan 05 step 3). `OutputSilent` was never
built; tests use `OutputCaptured`.

## Tasks

### 1. Dependencies
`bun add effect @effect/platform @effect/platform-bun`. Pin the same
minor across the three. No `@effect/cli` yet (phase 07 decides).

Record (2026-09-25): `lzuplzlz` added all three; the review follow-up
`loqnqzlo` removed the two platform packages "until phase 02 uses
FileSystem" because `BunRuntime.runMain` exited before yargs finished and
nothing else imported them. Phase 02 did not bring them back. Phase 08
task 1 does, with caret ranges; `@effect/cli` is decided in phase 09.

### 2. `cli-yargs/lib/effect/errors.ts`
One module, one tagged class per failure the CLI can report:

```ts
export class ConfigError extends Data.TaggedError("ConfigError")<{ path: string; key: string; reason: string }> {}
export class BlueprintError extends Data.TaggedError("BlueprintError")<{ title: string; reason: "missing" | "no-hash" }> {}
export class ProviderError extends Data.TaggedError("ProviderError")<{ op: string; cause: unknown; retryable: boolean }> {}
export class UtxoNotFound extends Data.TaggedError("UtxoNotFound")<{ address: string; asset?: string }> {}
export class DatumParseError extends Data.TaggedError("DatumParseError")<{ what: string; cbor: string; reason: string }> {}
export class TxBuildError extends Data.TaggedError("TxBuildError")<{ command: string; traces: readonly string[]; cause: unknown }> {}
export class SubmitError extends Data.TaggedError("SubmitError")<{ txId?: string; attempts: number; cause: unknown }> {}
export class InputParseError extends Data.TaggedError("InputParseError")<{ source: string; issues: readonly string[] }> {}
export class AikenBuildError extends Data.TaggedError("AikenBuildError")<{ phase: string; exitCode: number }> {}
export type CliError = ConfigError | BlueprintError | ProviderError | UtxoNotFound | DatumParseError | TxBuildError | SubmitError | InputParseError | AikenBuildError;
```
Grow the union in later phases only when a new failure class appears; a
new string reason is not a new class. Everything else is a defect
(`Effect.die`).

As built (phases 01–04), the taxonomy in `cli-yargs/lib/effect/errors.ts`
is: `ConfigError {source: "aiken.toml" | "env", key, reason}`,
`BlueprintError {environment, source: "deployed" | "build", reason}`,
`ProviderError {op, cause, retryable, status?}`,
`UtxoNotFound {lookup: by address | asset at address | tx ref}` (a union
since the phase 04 follow-up, built through `UtxoNotFound.at/holding/byRef`),
`DatumParseError`, `TxBuildError`,
`SubmitError`, `InputParseError`, `StakeNotRegistered` (phase 02),
`AikenBuildError {phase, reason}`, `PreconditionFailed {command, reason}`
(phase 04), `VerificationFailed` and `FileWriteError` (phase 03). Phase 08
turns the prose `reason` fields that carry an exit code, HTTP status or
path into fields.

### 3. Services (`cli-yargs/lib/effect/services.ts`)
- `Config`: `loadAikenConfig` result plus env (`getEnvVar`, deployer
  address, thresholds). `ConfigLive(environment)` layer; reads
  `aiken.toml` once through `@effect/platform` `FileSystem`.
- `Blueprint`: the `contract_blueprint` module for the active network;
  `validatorHash(title)`, `script(title)` fail with `BlueprintError`.
- `Provider`: wraps a Blaze `Provider` (`createProvider`); every method
  returns `Effect<_, ProviderError>`; `BlockfrostLive`, `KupmiosLive`,
  `EmulatorLive(emulator)` (tests).
- `Output`: `printSuccess`/`printError`/… and file writes as effects;
  `OutputLive` writes to the console, `OutputSilent` for tests. Also the
  single place that renders `CliError` to text (`renderError`).
- `Clock`/`Random` come from Effect; `sleep` in `submit.ts` becomes
  `Effect.sleep`.

As built: `Provider.use` fails with `ProviderError | ConfigError` (the
provider connects on first use and its credentials come from `Config`);
the layers are `ProviderLive(environment, type)` (requires `Config`),
`ProviderEmulator(emulator)` and, for tests, `OutputCaptured(capture)`.
`renderError` lives in `errors.ts` next to the taxonomy and is called from
`run.ts` (through `Output.error`) and `describeCause`. Defects and
interrupts are printed raw with `console.error` in `run.ts` after the
runtime has finished, outside any service; phase 09's `runMain` teardown
replaces that.

### 4. `runCommand` (`cli-yargs/lib/effect/run.ts`)
```ts
export const runCommand = <A>(name: string, argv: GlobalOptions, program: Effect.Effect<A, CliError, CliServices>) =>
  program.pipe(
    Effect.provide(CliLive(argv)),
    Effect.tapError((e) => Output.error(renderError(e))),
    Effect.catchAll(() => Effect.sync(() => process.exit(1))),
    BunRuntime.runMain,
  );
```
yargs stays the parser. A handler becomes
`handler: (argv) => runCommand("info", argv, infoProgram(argv))`.

As built (`loqnqzlo`): `runCommand(argv, program)` with no name, over
`Effect.runPromiseExit` plus a SIGINT `AbortController` and one
`process.exit(1)` after the runtime has finished, because `runMain` exited
before yargs's own exit. Phase 09 removes `runCommand` and yargs together
and runs the command tree through `BunRuntime.runMain`.

### 5. Lint gate (`eslint.config.js`, `cli-yargs/**`)
Add `no-throw-literal` and a repo rule (or `no-restricted-syntax`) that
bans `ThrowStatement` and `CatchClause` without a binding in files under
`cli-yargs/lib/effect/**` now, widened per phase as modules move. Also ban
`process.exit` outside `cli-yargs/index.ts` and `run.ts`; like the throw rule,
the ban covers the Effect files and the ported commands and widens as each
command moves (the three remaining calls are in `verify`, `sign-and-submit`
and `combine-signatures`).

### 6. Smoke
Port `generate-key` (61 lines, no provider) as the first command to prove
the bridge; its test runs through `tests/helpers/effect.ts` (phase 06
step 2 lands the helper here).

## Acceptance
- Gate green; `generate-key` output byte-identical to before.
- Commit: `effect: runtime, error taxonomy, services, generate-key`.

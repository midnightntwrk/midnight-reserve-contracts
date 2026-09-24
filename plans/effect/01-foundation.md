# Phase 01 — Foundation

Goal: the runtime, the error taxonomy and the services every later phase
plugs into; nothing user-visible changes.

## Tasks

### 1. Dependencies
`bun add effect @effect/platform @effect/platform-bun`. Pin the same
minor across the three. No `@effect/cli` yet (phase 07 decides).

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

### 5. Lint gate (`eslint.config.js`, `cli-yargs/**`)
Add `no-throw-literal` and a repo rule (or `no-restricted-syntax`) that
bans `ThrowStatement` and `CatchClause` without a binding in files under
`cli-yargs/lib/effect/**` now, widened per phase as modules move. Also ban
`process.exit` outside `cli-yargs/index.ts` and `run.ts`.

### 6. Smoke
Port `generate-key` (61 lines, no provider) as the first command to prove
the bridge; its test runs through `tests/helpers/effect.ts` (phase 06
step 1 lands the helper here).

## Acceptance
- Gate green; `generate-key` output byte-identical to before.
- Commit: `effect: runtime, error taxonomy, services, generate-key`.

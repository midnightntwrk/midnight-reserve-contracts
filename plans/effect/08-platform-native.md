# Phase 08 — Platform-native lib

Goal: the lib stops wrapping Node and Bun primitives in `Effect.try` and
uses the Effect platform for every effectful edge: files, processes,
HTTP, logging, configuration. Every command still prints and writes
byte-identical output; yargs stays the parser until phase 09, so the
existing goldens and the preview live checks remain the harness.

## Why this phase exists

Phase 01 added `@effect/platform` and `@effect/platform-bun`; its review
follow-up (`loqnqzlo`) removed them "until phase 02 uses FileSystem".
Phase 02 never brought them back and no commit recorded why: `config.ts`,
`versions.ts`, `output.ts`, `transaction-json.ts` and `build-engine.ts`
wrap `readFileSync`/`writeFileSync` (40 sites), `build-engine.ts` wraps
`Bun.spawn`, `versions.ts` still calls `execSync`, `blockfrost.ts` and
`governance-provider.ts` call `fetch`, `Output` is `console.log` behind a
tag, and nothing logs through `Effect.log*`. Blaze provider calls through
`Provider.use` carry `retryable: false` unconditionally and no timeout, so
`submit.ts` classifies retries by matching the error message. None of
this was a blocker; it was a deferral that drifted. This phase closes it
before any more commands are written.

Versions (checked 2026-09-25): `effect` 3.22.2, `@effect/platform`
0.97.2, `@effect/platform-bun` 0.91.2; `@effect/cli` 0.77.2 peers on
`@effect/platform ^0.97.1`, so this set also serves phase 09.

## Tasks (one commit each)

### 1. Dependencies and the runtime context
`bun add effect@^3.22.2 @effect/platform@^0.97.2 @effect/platform-bun@^0.91.2`
(caret ranges like every other dependency). `runCommand` provides
`BunContext.layer` (FileSystem, Path, CommandExecutor, Terminal) and
`FetchHttpClient.layer` under `CliLive`, so the lib can require them.
`CliServices` grows by those platform tags; tests' `EmulatorLive` provides
the same `BunContext.layer` (real filesystem in tests is fine: the tests
already read `aiken.toml` and the blueprints).

### 2. FileSystem
`config.ts` (`readAikenConfig`), `versions.ts` (every read, write, copy,
mkdir, exists), `output.ts` (`writeText`), `transaction-json.ts` (now
`json-files.ts`), `build-engine.ts` (toml edit, backup/restore, blueprint
mtime check) use `FileSystem` from the context. `PlatformError` is
translated once per module into the existing classes (`ConfigError`, `BlueprintError`,
`FileWriteError`, `AikenBuildError`) with the path in a field, never in
prose. `Either` cores that only parse stay `Either`; the functions that
read become `Effect<_, E, FileSystem>`. As built: the pre-Effect blocks
(`loadAikenConfig`, `saveVersionSnapshot` and the sync writers behind the
unported deploy family) keep their sync `fs` calls until phase 05 removes
them, so the grep counts only the Effect surface. `SettingsLive` and
`OutputLive` are `Layer<_, never, FileSystem>`; the versions reads are
`Effect<_, BlueprintError, FileSystem>` and `BlueprintError` /
`AikenBuildError` carry the file in `path`. Acceptance:
`grep -rn "readFileSync\|writeFileSync\|existsSync\|mkdirSync\|copyFileSync\|statSync" cli` = 0,
where the ported commands are the eighteen under the strict lint block
(`verify` reads its JSON with `readFileSync` inside `Effect.try`, `build`
copies the blueprint with `copyFileSync`); the unported deploy family
(`deploy`, `deploy-staging-track`, `mint-tcnight`) is phase 05.
`sign-and-submit` and `combine-signatures` were ported in plan 09 task 0.

### 3. Command (subprocess)
`build-engine.ts` runs `aiken` and the blueprint generator through
`@effect/platform` `Command` (`Command.make(...).pipe(Command.stdout("inherit"), Command.stderr("inherit"), Command.exitCode)`);
`versions.ts` reads the git commit through `Command.string`.
`AikenBuildError` carries `{ phase, exitCode }` plus the reason.
SIGINT: `BunRuntime`-style interruption reaches the child through the
executor; the phase 02 AbortController goes away with `Bun.spawn`.
As built: `processExitCode` runs `Command.make(...)` with inherited stdio
and `Command.exitCode`; `AikenBuildError` carries `exitCode`; the blueprint
generator runs through `Command` in versions and build. `currentGitCommit`
and the sync generator sit in the pre-Effect block (only
`saveVersionSnapshot`, deploy's, uses them) until phase 05. The
`AbortController` in `runCommand` interrupts the fiber on SIGINT, which
the executor turns into a kill of the child; phase 09's `runMain` replaces
it. Acceptance: `grep -rn "Bun.spawn\|execSync\|execFileSync" cli` = 0
outside the pre-Effect block;
`just build` output byte-identical; `build-from-deployed -n preview`
reproduces `plutus-preview.json`.

### 4. HttpClient
`blockfrost.ts` and the reward-account check use `HttpClient` with
`HttpClientRequest.setHeader("project_id", ...)`, `Effect.timeout("30 seconds")`,
and `HttpClientResponse.schemaBodyJson` over Schema types for the address
UTxO page and the account record. `ProviderError` gains structured fields
from `HttpClientError` (`reason`, `status`); `retryable` is
`status >= 500 || status === 429 || reason === "Transport"`. As built:
`blockfrostGet` runs `HttpClientRequest.get` with the `project_id` header
through `HttpClient.execute` under the 30 s `Effect.timeoutFail`;
`ProviderError.reason` is the client's `RequestError`/`ResponseError`
reason (or `Timeout`); the payload parsers stay hand-written until task 8
brings Schema; the legacy `fetch` in governance-provider's pre-Effect block
stayed until plan 09 task 0 deleted it with `run-cnight-mint-mainnet`
(`xukomsunwxxr`). Acceptance:
`grep -rn "fetch(" cli` = 0 outside the pre-Effect blocks; `dust-participants -n preview`
(36 pages) and `info`/`verify` goldens identical.

### 5. Provider.use: timeout and classification
`Provider.use(op, f)` applies `Effect.timeout` (default 30 s, one
constant) and classifies the Blaze failure into `retryable` by cause
shape (transport errors and `TimeoutException` retryable; a Blaze
`Error` with an HTTP status ≥ 500 retryable; anything else not).
`submit.ts` retries on `error.retryable` only; the `isNetworkError`
string match is deleted. Pinned on the test clock in
`tests/effect-tx.test.ts`. `awaitConfirmation` becomes
`Effect.repeat(poll, Schedule.spaced(...))` under `Effect.timeout("5 minutes")`
as plan 02 said, replacing the provider's own timeout argument.
As built: `providerFailure` classifies by shape only — a `TimeoutException`
and a cause (or its cause) carrying a `code` field are retryable; Blaze
throws plain `Error`s with the HTTP status in the message and no field, so
a 5xx reported by Blaze is not retried (the Blockfrost REST path in
`blockfrost.ts` classifies by status). (Superseded: the Blaze query patch
sets `status` on a Blockfrost submit failure, and `providerFailure`
classifies it through `retryableStatus` (`mvurwwop`); Blockfrost GETs and
address reads retry on a retryable failure (`llvoxyzt`).) Confirmation polls
`awaitTransactionConfirmation(txId, 1)` every 5 s under the 5-minute
timeout; each poll keeps the submit retry policy.

### 6. Logging and Console
`Output.log`/`stderr`/`write` implement over `Console` (`Console.log`,
`Console.error`), which prints bytes verbatim; that keeps every golden.
Diagnostics that are not user output use `Effect.logWarning` with
`Effect.annotateLogs` fields: the datum-versions fallback
(`{ family, requestedRound, usedRound }`), retry announcements, the
advisory local-UPLC failure. The default logger is `Logger.pretty` on a
TTY and `Logger.logfmt` otherwise; `--log-level` is the `@effect/cli`
built-in in phase 09 (until then a `LOG_LEVEL` env read). One test
asserts the fallback warning through a captured `Logger`.
As built: `Output.write` (a progress prefix without a newline) stays on
`process.stdout.write`, which `Console` cannot express (superseded: it is
`Terminal.display`, `poxtsxmk`); the retry
announcements and the advisory local-UPLC failure (with `cause`, `traces`
and `redeemers` fields) are `Effect.logWarning`, so they no longer appear
on stdout; `LoggerCaptured(capture)` records logs for tests and
`EmulatorLive` includes it; a bad `LOG_LEVEL` is refused in `runCommand`
before the runtime starts.

### 7. Configuration
`.env` is read through `PlatformConfigProvider.layerDotEnvAdd(".env")`
layered under `ConfigProvider.fromEnv()`, and every env read in
`config/settings.ts` becomes `Config.string`/`Config.redacted` (private keys and
Blockfrost keys are `Redacted`, so they can never be logged). Missing or
malformed values are `ConfigError` as today. `process.env` is not read
anywhere in `cli` afterwards.
As built: `SettingsLive(environment)` (`ConfigLive` before the Settings rename) reads every value through the fiber's
ConfigProvider (`Config.option` over `Config.string`/`Config.redacted`; an
empty value is unset, a provider failure other than missing data is a
defect); `secret`/`optionalSecret` return `Redacted` for the private-key
groups and the Blockfrost keys, `parsePrivateKeys` takes the `Redacted`,
and `optionalEnvVar` is gone. `CliLive` adds `layerDotEnvAdd(".env")` as
the fallback under the process environment (Bun's own `.env` load still
fills `process.env` first); `verify`, `dust-participants` and `info` on
preview under `bun --no-env-file` match the goldens, the Blockfrost key
coming from the dotenv layer. Tests install `EnvVars(vars)`
(`Layer.setConfigProvider` over `ConfigProvider.fromMap`), so no test reads
the process environment or `.env`. `process.env` is a lint error in the
strict block; it remains in the pre-Effect blocks of `config.ts`,
`candidates.ts` and `signers.ts` (phase 05) and for `LOG_LEVEL` in
`runCommand`, which sets the logger before the runtime starts, until
phase 09's `--log-level`.

### 8. Schema
Schema types for the JSON the CLI reads and writes: `plutus.json`,
`versions.json`, `changelog.json`, the transaction file, the
deployment output, the Blockfrost payloads (task 4). `parseNetworkConfig`
stays a hand-written Either over the toml table (its shape is Aiken's,
not ours), and the signer/candidate grammars stay hand-written parsers
as `pqnzqvkk` recorded. Decode failures keep their current classes with
the Schema `TreeFormatter` message in `reason`.
As built: `lib/json-files.ts` holds the file schemas (`PlutusJson` and
`PlutusValidator`, `VersionsJson`, `Changelog` and `ChangeRecord`,
`TransactionFile`, `DeploymentFile`, `DeploymentTransactions`) and
`decodeJson`, which decodes text through `Schema.parseJson` with
`propertyOrder: "original"`. A plutus.json keeps every field it was read
with (a rest record), so a merged snapshot writes back what it read; every
plutus.json in the repository round-trips in `tests/json-files.test.ts`.
versions, build-engine (fresh and deployed blueprints), verify and
`readTransactionFile` decode through them, the TreeFormatter message in the
error's reason (issues for `InputParseError`); identifiers keep the tree
short. `types.ts` re-exports `TransactionOutput` and `DeploymentOutput`
from the schemas. `blockfrostGet(baseUrl, apiKey, path, schema)` decodes
through `HttpClientResponse.schemaBodyJson`; a body that does not match is
`ProviderError { reason: "Decode", retryable: false }`. The account check
passes `Schema.Unknown`, since only the status is read.
`tests/blockfrost.test.ts` runs the reads against a stub HttpClient
(decode, field paths, 404, status classification, paging). Live: verify,
dust-participants (36 pages) and info match the goldens;
`build-from-deployed -n preview --trace verbose` reproduces
`plutus-preview.json`. Open: the offline `verify`/`dust-participants`
goldens plan 03 expected need recorded Blockfrost responses; the stub
client is the harness, the preview live check stays the reference.
Picked up by plan 06 task 1 (the stub client was deleted later, in
`spowttmk`).

## Rules
- `Effect.try` around a synchronous Node API is a smell: the platform
  service exists for it. `Effect.tryPromise` is allowed only around Blaze.
- Retry and timeout decisions come from tagged fields, never from message
  text.
- Behaviour-preserving: outputs and files identical to phase 04; the
  preview live-check method from phase 04 applies to each touched command.

## Acceptance
- The greps in tasks 2–4 are empty; `grep -rn "console\." cli`
  = 0; `grep -rn "process.env" cli` = 0. Each grep counts only
  the Effect surface: the pre-Effect blocks (phase 05) and the composition
  root in `lib/effect/run.ts` (phase 09) are outside it.
- Gate green; goldens identical; `just build` files identical; Aiken
  untouched.
- Review with `caveman:cavecrew-reviewer` (opus) over the phase's
  commits; follow-up commit before phase 09.

## Review record (2026-09-25)
Two `caveman:cavecrew-reviewer` (opus) passes, tasks 1–4 and tasks 5–8.

Tasks 1–4, fixed in the first follow-up commit: the deployed-blueprint
generator (`versions.ts`) inherits stderr again and a failure carries
`BlueprintError.exitCode`, as does the build command's generator; every
build-engine and versions mapper puts the file in `path` and uses the
platform message (which names the file) as the reason, without a second
prefix, and the aiken.toml backup goes through `tomlFailure`; SIGTERM and
SIGHUP interrupt like SIGINT; the aiken.toml temp write and rename are
uninterruptible; a child stopped by a signal is "was stopped", not "could
not start" (`processFailure`); a blueprint without a modification time
fails with its own reason; `freshBlueprint` and the toml updaters require
only FileSystem; a Blockfrost transport failure keeps the fetch cause, so
no ProviderError holds the request or its `project_id` header; Blockfrost
requests are untraced (no span records the key, no b3/traceparent headers
go out, as with fetch); `promotedValidatorHash` (no production caller) is
removed. New tests: Blockfrost transport, timeout and
`rewardAccountRegistered`; `processExitCode` exit code, start failure,
signal and kill on interrupt.
Recorded, not changed: a Blockfrost status failure no longer carries the
status text ("500", was "500 Internal Server Error"; HttpClientResponse
does not expose it). A second Ctrl-C while finalizers run still ends the
process without them; phase 09's `runMain` owns signal handling. The
versions writers (stage, promote, merge) have no test: they write under
the fixed `deployed-scripts/`, and phase 07's snapshot service gives them
a root a test can point at.

Tasks 5–8, fixed in the second follow-up commit: the logs were on stdout
(`Logger.pretty` and `Logger.logFmt` print through `Console.log`), so the
task 6 note did not hold; `LoggingLive(level, tty)` now replaces the
default logger with `prettyLogger({ stderr: true })` on a TTY and
`withConsoleError(logfmtLogger)` otherwise, and a test pins the stream.
The confirmation lookups pass 0 to `awaitTransactionConfirmation` (one
check; Blaze Blockfrost printed a stdout warning for any timeout under
20 s). `providerCall` times out through `timeoutFail`, so `providerFailure`
has no timeout branch; the confirmation timeout counts the polls without an
`attempts: 0` marker. `Provider.unspentOutputs(address)` reads an address
under `ADDRESS_READ_TIMEOUT` (5 minutes): Blaze pages through it one
request at a time, which one 30 s bound would cut on the addresses
merge-utxos exists for. A failed Ogmios connect is `connectFailure`, final
because the connection is cached. `DotEnvFallback(path)` is the CliLive
layer and has a test (the primary wins, `.env` fills, a missing file adds
nothing); `parseLogLevel` has tests. The awaitConfirmation tests run over
`ProviderOver` (a Provider over any Blaze provider), so retries inside a
poll go through the real classifier; the timeout is exactly 61 polls.
Recorded, not changed here: `isNetworkError` and the message-text retries
stayed in the pre-Effect block of `submit.ts` (`submitWithRetry`,
`awaitTxConfirmation`). Plan 09 task 0 ported `sign-and-submit` and
`combine-signatures` onto `submitTx`/`awaitConfirmation`, and `rxryxxkv`
("effect(05): delete the hand-written submit loop") deleted the block;
every retry now follows `ProviderError.retryable`. The composition root
keeps two `console.error` calls, the refused `LOG_LEVEL` and the defect
print after the runtime ends, until phase 09. A plutus.json validator must
carry `compiledCode`, which the versions readers did not require before;
aiken always writes it and every repository file has it.
Live after the follow-up: `register-gov-auth -n preview` builds the golden
transaction except its input (`#11` for `#10`, which the golden
transaction spent on chain).

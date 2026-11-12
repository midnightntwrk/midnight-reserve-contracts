# Phase 09 — `@effect/cli` command layer

Goal: yargs goes; the CLI is one `@effect/cli` command tree run by
`BunRuntime.runMain`. Every ported `<name>Program` is re-hosted behind
an `@effect/cli` `Command` and takes its input parsed at the boundary;
the pure builders and the domain modules do not move (task 0 placed
them). Decision 2026-09-25: this replaces the phase 07
go/no-go ("keep yargs unless ...") with a decision for `@effect/cli`.
The goal of the migration is Effect, not yargs with Effect inside.

Depends on phase 08 (platform context, `Console` output, ConfigProvider).

Decisions 2026-09-25 (architecture review after task 0):
- Parse at the boundary. A program takes a typed input record, not the
  argv record: `@effect/cli` parses each option through a parser from
  `cli/input.ts` (an `Either` function wrapped by `parsedText`), so a bad argument is a `ValidationError` before any
  service is built (today the program parses it after Settings, the
  blueprint and the provider are up). The argument parsers inside the
  programs go. No domain module imports `cli/options.ts` or
  `@effect/cli`. The error text for a bad argument is `@effect/cli`'s.
- `chain/` keeps the transaction modules (provider reads, building,
  signing, files, submit); there is no `tx/` folder.
- No argv tests. Tests test functions: the input parsers get unit tests
  and the programs are called with typed input. The command layer is
  manual QA (see Acceptance).

## Shape

```
cli/
  index.ts             # the root; task 3 swaps its yargs body for Command.run |> provide |> BunRuntime.runMain
  options.ts           # shared options: network, profile (build's --network), provider, use-build, format, output, output-file, fee-padding, tx-hash/tx-index (feeUtxo), signing-key/no-sign-deployer (deployerSigning), no-sign; parsedText
  run.ts errors.ts output.ts input.ts   # the Effect runtime edge and shared modules (input.ts: argument, text and JSON-file parsers)
  commands/<name>.ts   # one module per command; task 2 rewrites each file in place as a `Command.make`
  config/ contracts/ chain/ datum/ governance/ report/ wallet/ deploy/   # programs and builders by domain
```

Task 0 (the 2026-09-25 restructure, recorded here as a deviation) moved
`cli-yargs/` to this layout before task 1, so no file moves twice: the
old `lib/` modules went to their domain folder at the same depth, each
`commands/<name>/index.ts` became `cli/commands/<name>.ts`, and the
program bodies left the command modules. It also deleted
`deploy-cnight-minting` and `run-cnight-mint-mainnet` and ports
`sign-and-submit` and `combine-signatures` onto
`submitTx`/`awaitConfirmation` (see plan 05). The Justfile, the
`package.json` scripts, the README, the eslint and tsconfig globs, the
test imports and `.claude/docs` changed in the task 0 commits.
A later cleanup split `json-files.ts` into `chain/tx-file.ts` and
`contracts/plutus-json.ts`, and `validation.ts` into `input.ts`,
`governance/threshold.ts` and the two-stage validator names in
`governance/two-stage-upgrade.ts`.

- A shared option is declared once in `cli/options.ts` (a command's own
  options in its module) and spread into each subcommand's config, so `midnight-reserve info -n preview` keeps
  working (options after the subcommand, the form the Justfile and README
  use). Required options are required by construction (`Options.text`
  without `withDefault`/`optional`); defaults use `Options.withDefault`;
  choices use `Options.choice`; aliases `-n -o -p` via
  `Options.withAlias`. Each domain module declares its program's input
  record with parsed types (`Environment`, `TxHash`, `TxIndex`,
  `ScriptHash`, a `bigint` fee padding, ...) and camelCase fields; the
  parsed type of the `Command` config satisfies it, so the handler is
  `(input) => program(input)`. The `*Options` interfaces and
  `GlobalOptions`/`TxOptions` go.
- `--network` is `Options.choice` over the known environment names
  (`ENVIRONMENTS`), so a network is an `Environment`. Choices are
  case-sensitive; the old resolver lower-cased the name. `build` and
  `build-from-deployed` take an aiken.toml profile (`PROFILES`,
  `default` included, as `just build` passes it), not an environment,
  and they get no Settings, Blueprint or Provider. A command declares
  only the options it reads (`generate-key` takes `--network` alone),
  so an unused global option is now an unknown argument.
- `runCommand` becomes the composition in `cli/index.ts`:
  `Command.run(...)(process.argv)` |> `Effect.provide(EnvLive)` |>
  `Effect.onExit(report)` |> `Effect.provide(BaseLive)` |>
  `BunRuntime.runMain({ disableErrorReporting: true, disablePrettyLogger: true })`.
  `EnvLive` is the logging at `LOG_LEVEL` over the process environment
  with `.env` as the fallback; it is inside the report, so a bad
  `LOG_LEVEL` is reported. `BaseLive` (platform, `HttpClient`, `Output`)
  cannot fail and is what the report needs. Without
  `disablePrettyLogger`, `runMain` adds its pretty logger (stdout) beside
  the CLI's stderr logger. A `CliError` is
  rendered through `Output` (as today), a `ValidationError` is what
  `@effect/cli` already printed, `--help`/`--version` succeed inside
  `CliApp.run`, a defect prints `Cause.pretty` of the cause without its
  failures and an interrupt alone its one line, on stderr, so no failure
  prints two times. The report runs in `Effect.onExit`, since `tapErrorCause`
  does not run in an interrupted fiber. The teardown exits 1 on any
  failure, an interrupt included (`defaultTeardown` exits 0 on an
  interrupt). Deviation (task 3): the teardown calls `process.exit`
  with the code, success included, as the yargs root's `process.exit(0)`
  did, since `runMain` does not exit on success and an open handle (the
  pre-Effect Kupmios socket of the phase 05 commands) would hold the
  process; it is the CLI's one exit, in `cli/run.ts`. SIGINT and
  SIGTERM are `runMain`'s interruption; SIGHUP is raised again as
  SIGTERM, so it also interrupts (phase 08).
- A command's services are built from its parsed `network`/`provider`/
  `use-build` options, not from a yargs argv object, by the helper it
  pipes through in `cli/run.ts`: `withServices(source)` (Settings,
  Blueprint, Provider over a fixed blueprint source),
  `withServicesUseBuild` (the same, with the source from `--use-build`),
  `withProvider` (Settings and Provider: `simple-tx`, `sign-and-submit`,
  `combine-signatures`, which read no blueprint),
  `withBlueprintUseBuild` (Settings and Blueprint: `info`,
  `dust-participants`) and `withSettings` (`verify`). The three report
  commands read the chain through Blockfrost, not the Provider, so they
  take no `--provider`. The blueprint source is an explicit
  `BlueprintSource` (`"deployed" | "build"`, no default) and the
  `Blueprint` service carries it, so a program names it in an error
  without a `useBuild` field (`promote-upgrade`,
  `register-cnight-mint-logic`). This removes the phase 04 handler
  overrides in `stage-upgrade` and `mint-staging-state`.
- Built-ins for free: `--help`, `--version`, `--wizard`,
  `--completions fish|zsh|bash`, `--log-level`. Help text changes shape
  (yargs → `@effect/printer-ansi`); that is the one accepted user-visible
  change. Command stdout stays byte-identical through `Console`. With
  it: no command prints the root help and exits 0 (yargs exited 1); a
  bad or missing option prints the `@effect/cli` text; a boolean that
  defaults to true is only its negation (`--no-sign`,
  `--no-sign-deployer`).
- `combine-signatures` takes the witness files as positional
  `<witness-file>...` (decision 2026-09-25): `@effect/cli` has no flag
  with several values, and a shell glob still passes a directory's
  files. `--signatures` goes.
- The phase 05 commands keep their Promise handlers, each with its own
  argv fields (`GlobalOptions` goes with yargs); their `Command` maps the
  parsed options onto them, with their own options as raw text, which
  phase 05 parses at the boundary. (Superseded by plan 05 steps 1–3: no
  Promise handler is left.)

## Tasks (one commit each)

1. Dependencies: `@effect/cli@^0.77.2`, `@effect/printer@^0.51.0`,
   `@effect/printer-ansi@^0.51.0` (direct peers of `@effect/cli`).
   The root command and one subcommand (`generate-key`) beside the yargs
   root, which serves the others from `cli/index.ts` until task 3.
2. Re-host the other ported programs (the read, governance and submit
   commands: 19) as `cli/commands/*.ts`. Deviation: three commits (read,
   governance, submit), not one per domain folder; the read commit
   spans `report/`, `contracts/` and `wallet/`. Each module is the option
   config and `Command.make(..., program)`; the ones with several
   command-specific parsed options (`simple-tx`, `merge-utxos`,
   `stage-upgrade`, `change-terms`) run to about fifty lines. Each program takes its typed input
   record; its tests pass typed input, and the rejection tests of its
   arguments move to the parser tests in `tests/input.test.ts`.
3. Delete yargs: the yargs parts of `cli/commands/*.ts` and
   `cli/options.ts`, and the `yargs` dependency; swap the body of
   `cli/index.ts` for the `@effect/cli` root. The commands phase 05 has
   not ported yet (`deploy`, `deploy-staging-track`, `mint-tcnight`) get
   `Command.make` handlers that wrap their Promise handler in
   `Effect.promise` (a rejection is a defect; superseded by plan 05
   steps 1–3: the three are Effect programs over typed input, and no
   `Effect.promise` is left). `runCommand` goes. No file
   moves: task 0 did the rename. After it, every caller holds an
   `Environment`, so `environmentOf` becomes total over it (no
   `Either`) in its own commit.
4. `Settings` reads through `ConfigProvider` (phase 08 task 7) with
   `Options.withFallbackConfig` where an option has an env fallback:
   `simple-tx --count`/`--amount` over `SIMPLE_TX_COUNT`/
   `SIMPLE_TX_AMOUNT`, whose `Settings` readers go. The `.env` fallback
   moves to the root layer, so option fallbacks read it
   (`DEPLOYER_ADDRESS` stays env-only; the phase 05 commands keep their
   env reads). `envFallback(name, parse, fallback)` in `settings.ts` is
   the Config: unset or empty is the fallback, other text goes through
   the parser, and a bad value is a `ValidationError` naming the key.
5. Lint gate covers all of `cli/**` except the three phase 05 files
   (superseded: no exemption is left since `lmkssqwm`, plan 05 step 3).

## Acceptance
- `bun cli/index.ts <every ported command> --help` exits 0;
  `bun cli/index.ts info -n preview` and the other goldens identical to
  phase 04 modulo the help text.
- Manual QA in a herdr tab, each output read: every command's `--help`,
  one bad argument, the `--fee-padding` default (50000, in the help and
  in `--wizard`), and the preview goldens (`info`, `verify`,
  `dust-participants`, `build-from-deployed --trace verbose`).
- `just build`, `just check`, `bun test` green; Justfile and scripts run.
- `grep -rn "yargs" cli tests package.json` = 0 after task 3.
- Review (opus) and follow-up before phase 05.

## Recorded differences (review follow-up)

- A bad value of the root built-in `--log-level` (`all trace debug info
  warning error fatal none`; `warn` is not one) prints `Received unknown
  argument: '--log-level'`: `@effect/cli` drops the built-in and the
  command parse refuses the flag. With a valid `--log-level`, a later
  `ValidationError` prints two times (`info --log-level debug -n bogus`):
  `@effect/cli`'s built-in handler prints it, then its outer catch prints
  it again; a failed `--wizard` parse takes the same path. The exit is 1.
  The CLI does not own that text.
- `LOG_LEVEL` is read before the parse (`EnvLive` wraps it), so a bad
  `LOG_LEVEL` fails `--help`, `--version` and `--completions` too, with
  `❌ Invalid env LOG_LEVEL: ...` and exit 1; yargs did not read it for
  those. A bad environment fails fast for every invocation.
- `simple-tx --amount ''` is refused at the boundary (`Invalid --amount:
  '' is not a positive base-10 integer`); an empty `SIMPLE_TX_AMOUNT` or
  `SIMPLE_TX_COUNT` still means the fallback.
- A bad `SIMPLE_TX_COUNT`/`SIMPLE_TX_AMOUNT` prints the `@effect/cli`
  Config text, `(Invalid data at SIMPLE_TX_COUNT: "'abc' is not a
  positive base-10 integer")`, not a `❌ Invalid env ...` line: the
  fallback is part of the option parse, so it fails as a
  `ValidationError`.

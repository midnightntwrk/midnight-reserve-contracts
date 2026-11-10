# Effect 4 CLI — index

The CLI is rewritten from scratch on Effect 4 (`effect` 4.1.3), with the
architecture of `plans/cli-architecture/` built in from the first commit.
It replaces main's yargs CLI (`cli-yargs/`). It lands as one series of
commits on bookmark `cli/effect4`, one PR, squash-merged.

The behaviour reference is the Effect 3 CLI of change `ouwrttzy` (`cli/`,
`tests/`, `eslint.config.js`, `plans/cli-architecture/`). The series ports
its intent, not its code. Where main and the reference differ, the series
follows [behaviour-changes.md](behaviour-changes.md).

## Effect 4 facts the design rests on

- `@effect/platform` and `@effect/cli` are folded into `effect`:
  `effect/cli` (Command, Flag, Argument, CliError, CliOutput, HelpDoc),
  `effect/http/*` (HttpClient, FetchHttpClient), `effect/process/*`
  (ChildProcess, ChildProcessSpawner), and `FileSystem`, `Path`, `Terminal`
  in the barrel. `@effect/platform-node` has `NodeRuntime.runMain` and
  `NodeServices.layer` (FileSystem, Path, Terminal, Stdio,
  ChildProcessSpawner).
- Every module above and all of `@effect/platform-node` are
  `@stability unstable`: minor releases may break them. Effect, Layer,
  Context, Schema, Config, Redacted, Result, Option, Cause, Logger and
  Schedule are stable.
- API shifts that touch most files: `Context.Tag` → `Context.Service`
  (layers built by hand, named `layer`); `Either` → `Result`;
  `Layer.scoped` → `Layer.effect`; `catchAll` → `catch`; capitalised Config
  constructors; Schema in core with new decode names. Help is a structured
  record rendered by `CliOutput.Formatter`.
- There is no `bun:test` integration. `@effect/vitest` 4.1.3 needs
  vitest >=5 <6, which needs Node ^22.18, ^24.11 or >=26. The CLI and the
  tests both run on Node, through Vite+ (D7).

## Target architecture

```
argv ─► effect/cli Command ─► typed input record = the TxIntent (one per command; parsed at the boundary)
   │
   ▼  Context resolution — the ONLY layer that does I/O
   │    Environment services: Profile (network config), DeployerAddress (wallet config),
   │      ProviderConfig, Keys (signing only)
   │    ContractResolver: one service over Blueprint + DeploymentRegistry (deployed-scripts record).
   │      Per-intent source rule: a command that ACTS ON deployed contracts reads them from the record;
   │      a command that CREATES contracts (full deploy, deploy --components, deploy-staging-track,
   │      stage-upgrade's new logic) takes what it creates from the build and writes it back through
   │      its RecordUpdate. A full deploy reads only the build and replaces the record (row 63).
   │      local/emulator have no record and read the build. No global --use-build source toggle:
   │      where --use-build remains (info, promote's staged-logic lookup) it only picks what to show or look up.
   │    ChainQuery (Provider reads), protocol parameters, slot config, Clock
   ▼
PlanningContext — frozen data per command (the command's resolved inputs + parameters + wallet UTxOs
   │                + reserved refs + slot config + contracts)
   ▼  pure from here down
plan(intent, ctx) ─► TxPlan + RecordUpdate          (no services, no Blaze; plan purity is a review rule)
compile(TxPlan, ctx) ─► unsigned Transaction       (the only Blaze TxBuilder user: coin selection,
   │                                                 balancing, local Blaze VM evaluation, size check;
   │                                                 reads parameters and UTxOs from ctx, never calls Provider)
   ▼  effects again
apply RecordUpdate ─► signAndWrite (Keys) ─► submit / confirm (Provider)
```

- **Blaze balances permanently** (user, 11-11). Coin selection, balancing
  and construction stay Blaze's, inside compile. Upstreaming Blaze-side gaps
  (reserved-UTxO exclusion, a witness-aware size check) is parked.
- Deploy's chained transactions plan as a fold: each compiled tx's outputs
  are added to the context for the next one, with no chain read in between.

Services are `Context.Service`, each with a hand-built `layer`:

| Service | Holds |
|---|---|
| `Profile` | the aiken.toml profile: one-shots, collateral, reserved refs |
| `DeployerAddress` | the deployer address, checked against the network |
| `ProviderConfig` | provider credentials, Redacted |
| `Keys` | signing keys, for signing only |
| `Provider` | named reads, parameters, submit, isConfirmed; one connection per run, no caching |
| `ContractResolver` | Blueprint and DeploymentRegistry behind the per-intent source rule; never builds |
| `Output` | everything printed |

Runtime edge: `NodeRuntime.runMain` + `NodeServices.layer` +
`FetchHttpClient.layer` + `ConfigProvider.fromEnv` with `.env` as the
fallback. Help is effect/cli's built-in help (no custom formatter).

## Toolchain (Vite+, D7)

| Concern | Tool |
|---|---|
| Runtime | Node 26, pinned in `package.json` `devEngines.runtime` (`vp env pin`); the CLI runs as `vpx cli/main.ts`, whose oxc-node loader resolves the extensionless imports |
| Packages | pnpm, pinned in `devEngines.packageManager`; `pnpm-lock.yaml`; `vp install` |
| Tests | `vp test` (vitest 5.1 from vite-plus) with `@effect/vitest` 4 |
| Lint | `vp lint` (oxlint), configured in the `lint` block of `vite.config.ts`; what oxlint lacks is a JS plugin |
| Format | `vp fmt` (oxfmt), in the `fmt` block of `vite.config.ts` |
| Type check | `vp check` with `typeAware` and `typeCheck` (TypeScript 7 through tsgolint) |
| CI | `voidzero-dev/setup-vp` at an exact release, pinned by SHA; then `vp check`, `vp test` |

## Layout (L1)

About 24 files by concern, each under about 700 lines. Every guarded secret
or write path has its own file, so the module-level lint rules can hold.

```
cli/main.ts        argv, Command tree, layers, runMain
cli/commands.ts    every Command declaration: input → resolve (PlanningContext) → plan → compile → write
cli/input.ts       boundary parsers and brands     cli/errors.ts   tagged errors     cli/output.ts   Output
cli/config.ts      Profile, DeployerAddress, env intent
cli/keys.ts        Keys (imported only by signing.ts and main.ts)
cli/chain.ts       ProviderConfig + Provider (Blockfrost / Kupmios / emulator); credentials never leave it
cli/tx.ts          PlanningContext, TxPlan, compile, labels, script helpers (calculateMinAda/Collateral re-exported)
cli/signing.ts     tx file, signAndWrite, combine-signatures, sign-and-submit
cli/contracts/     resolver.ts (ContractResolver + Blueprint), snapshot-read.ts, snapshot-write.ts (RecordUpdate apply), build.ts (engine + bindings)
cli/datum.ts       datum codecs (multisig, federated ops, terms, signers)
cli/governance/    multisig.ts, forever.ts, cnight.ts, two-stage.ts, staging.ts
cli/deploy.ts      cli/wallet.ts      cli/report.ts
```

## Decisions (user, 2026-11-10)

- **D1 Spec = ouwrttzy's behaviour**, with two calls on
  [behaviour-changes.md](behaviour-changes.md): row 17 is fixed (stage-upgrade
  `--use-build` takes the forevers, threshold and gov auth from the deployed
  record wherever one exists; local/emulator use the build), and row 63
  follows the reference (a full deploy on a test environment replaces the
  deployed-scripts record). Every other row follows the reference.
- **D2 Complete switch, as a series.** Commit 1 deletes `cli-yargs/` and
  brings the Effect 4 `build`; later commits add commands. The two CLIs
  never coexist in a commit.
- **D3 Caret ranges:** `effect ^4.1.3`, `@effect/platform-node ^4.1.3`, kept
  at the latest version.
- **D4 effect/cli's built-in help**, no custom formatter.
- **D5 Layout L1.**
- **D6 vitest + @effect/vitest** (vitest a new org, chosen by the user);
  the surviving tests are converted in commit 1. Superseded in its tooling
  by D7.
- **D7 Vite+ for everything (user, 11-11), in commit 1.** Node instead of
  Bun for the CLI and the tests; pnpm instead of bun as the package
  manager; `vp test`, `vp lint` (oxlint instead of eslint), `vp fmt` (oxfmt
  instead of prettier) and `vp check` (TypeScript 7 instead of `tsc`); CI on
  `setup-vp`. Bun leaves the project. New orgs: voidzero-dev (vite-plus),
  oxc, pnpm.
- **Plan purity (user, 11-11): review-only.** `plan*` functions take no
  services and no Blaze; review enforces it, not lint.

## Dependency rules (lint, from commit 1)

Every file of `cli/`: no `fs` or `child_process` (FileSystem and
ChildProcess), no `throw` or `try`, no `process.exit` or `process.env`, no
Effect runners, no `fetch` global, and relative imports in canonical form
(`./a/b`, no extension) so the rules below cannot be dodged. In `cli/` and
`tests/`: no `bun`, `bun:*` or `@effect/platform-bun` import and no `Bun`
global. A rule may name a module that does not exist yet.

| Module | Rule |
|---|---|
| `tx.ts` | imports no `contracts/**`, `config`, `keys`, `signing` |
| `signing.ts` | imports no `contracts/**` |
| `keys.ts` | imported only by `signing.ts` and `main.ts` |
| `ProviderConfig` | named by no module but `chain.ts` |
| `contracts/snapshot-write.ts` | imported only by `deploy.ts`, `governance/two-stage.ts` |
| `contracts/snapshot-read.ts` | imported only by `contracts/**`, `deploy.ts`, `governance/two-stage.ts`, `report.ts` |
| `contracts/build.ts` | imported only by `commands.ts`, `contracts/snapshot-write.ts` |
| `contracts/snapshot-read.ts`, `contracts/snapshot-write.ts` | import no `output` |
| Blaze | `@blaze-cardano/sdk` and `@blaze-cardano/tx` are imported only by `tx.ts` and `chain.ts`; `Provider.blazeFor` is read only in `tx.ts` (defined in `chain.ts`) |

Plans (`plan*`) take no services; with plans living beside their commands in
L1 that is a review rule, not a module rule.

Three rules date from the architecture before the 11-11 revision: the
`blazeFor` rule, the `tx.ts` boundary and the `contracts/snapshot-read.ts`
importers. Each is settled in the commit that adds its module, and that
commit message says what changed and why.

## Commits

Every commit passes the gate `just fmt && just build && just check && vp
test` with no diff produced by the gate, and leaves Aiken and
`plutus*.json` untouched. `just build` runs `vpx cli/main.ts build`.

| # | Commit | Adds | Verified by |
|---|---|---|---|
| 0 | plans(effect4) | this architecture, the dependency rules, the commit plan, the oracles | the user's review |
| 1 | cli: Effect 4 switch with `build` | deletes `cli-yargs/` and every test that imports it. Deps: effect and @effect/platform-node ^4.1.3, vitest 5.1.0, @effect/vitest ^4.1.3; drops yargs, @types/yargs, cbor, globals, eslint, prettier and typescript; keeps toml. main.ts, errors, input, Output. `Profile` (config.ts). contracts/build.ts (build engine + bindings, via ChildProcess for aiken) and the `build` command; `generate-key`. Node 26, pnpm and Vite+ (D7): no package.json scripts; the Justfile `build`, `cli`, `use-env`, `fmt` and `check` recipes call `vp`/`vpx`. CI runs `vp check` and `vp test` through setup-vp. CLAUDE.md gate line; surviving tests converted to vitest. Dependency rules in oxlint: vite.config.ts plus the `mrc` JS plugin (ported from the reference `eslint.config.js`, adapted to the L1 modules). pnpm `minimumReleaseAge` 2880 and the type-fest packageExtensions fix | **Build output equal to the reference's**, per profile, in fresh scratch trees: every file either writes, including `contract_blueprint.ts`, which a non-default build overwrites by design (reference `cli/contracts/build.ts:39-47`). Only the default build (the gate's `just build`) must leave the tree clean. Also: build-engine tests (intent of `tests/build-engine.test.ts`); generate-key and input tests; 42 planted lint violations fire (throwaway); the CI steps reproduced |
| 2 | cli: environment services | DeployerAddress and env intent (config.ts); Keys (keys.ts) | config tests (intent of `tests/config.test.ts`); lint: keys.ts importable only by signing.ts and main.ts (planted violation fails) |
| 3 | cli: ChainQuery | Provider over Blockfrost/Kupmios/emulator: named reads, parameters, submit, isConfirmed | blockfrost tests (401/403 at once, 429/5xx retry), emulator confirmation |
| 4 | cli: contract system and ContractResolver | Blueprint, DeploymentRegistry (snapshot read, snapshot write + RecordUpdate), ContractResolver with the per-intent source rule, `build --from-deployed` | snapshot tests; resolver tests per rule case (acts-on → record; creates → build; full deploy → build only; local/emulator → build); `build --from-deployed` pins equal to the reference |
| 5 | cli: PlanningContext and compile | PlanningContext (frozen), TxPlan, compile over Blaze TxBuilder with parameters and wallet UTxOs from the context and the local Blaze VM (no Provider call inside compile), labels, scripts. Blaze mutates the objects it is given (e.g. `TxBuilder.checkAndAlterOutput` sets coin on the output's own `Value`; @blaze-cardano/tx 0.15.4 dist/index.mjs:744–752), so compile hands Blaze **copies** (CBOR round trip) of every SDK object it takes from the plan or the context | emulator compile tests; compile runs with a Provider layer that fails every call; **non-mutation and replay:** the CBOR of TxPlan and PlanningContext is byte-identical before and after compile, and compiling the same (TxPlan, ctx) twice gives identical tx CBOR (including a plan whose output is below min-ADA); lint: Blaze only in tx.ts/chain.ts |
| 6 | cli: signing | tx file, signAndWrite, combine-signatures, sign-and-submit | witnesses verify against the tx id; golden tx-file read |
| 7 | cli: reports | info, verify, dust-participants | verify test from plutus-default.json; read-only `info`/`verify` output equal to the reference (manual, go needed) |
| 8 | cli: wallet commands | simple-tx, mint-tcnight, merge-utxos | L2 goldens (input, frozen ctx) → TxPlan; L3 emulator acceptance; **tx id equal to the reference's for the same UTxOs** (throwaway script, result in the commit message) |
| 9 | cli: governed-forever and multisig | change-council, change-tech-auth, change-terms, change-federated-ops | same as 8 |
| 10 | cli: migration, cNIGHT, registrations, staging state | migrate-federated-ops, run-cnight-mint(-mainnet), register-gov-auth, register-cnight-mint-logic, mint-staging-state | same as 8 |
| 11 | cli: two-stage upgrade | stage-upgrade (row 17 fixed by the resolver rule), promote-upgrade, record writes | same as 8, plus the mainnet upgrade transaction tests; row-17 test: on preprod the forevers/threshold/gov auth come from the record |
| 12 | cli: deploy | deploy (`--components`, full deploy replaces the record), deploy-staging-track; chained txs as a fold over the context | same as 8, plus the deploy tests |
| 13 | docs: architecture and finish | docs/architecture/cli.md (this architecture, one page with the diagram); README quick start + command table; docs/governance runbook; CLAUDE.md points at docs/architecture; removes `.claude/docs/`, `plans/effect/` and `plans/effect4/` (their lasting decisions moved into docs/architecture/cli.md); removes `extract-witnesses.ts` (row 53); no `cli-yargs` reference left | gate; CI steps reproduced; root and per-command help (manual) |
| Q | **Live QA on preview** (user, 11-11): not a commit; runs after 13, before the PR opens. Anything it finds is fixed in the commit it belongs to. **The test deployment is temporary** (user, 11-11): afterwards the old preview record is restored. Q runs in a fresh empty change on top of commit 13, so every file it writes lands only in that change. Afterwards that change is restored to its parent (`jj restore`, i.e. back to commit 13) and abandoned. This keeps the series' own intended record changes (e.g. row 79 drops `beefy_signer_threshold.else` from deployed-scripts/preview); restoring to the pre-series base would undo them. None of the run's record writes enter any commit. | Read-only `info`/`verify` on preview and mainnet. Then submitted on preview: a fresh test deployment (12 governance txs + cNIGHT minting), `verify`, `register-gov-auth`, `mint-tcnight`, one `change-*` command, and a stage → promote cycle on that test deployment. The worker builds, signs and submits with the preview keys from the user's .env (copied into its workspace; gitignored, never committed), and **asks for the user's go before each submission**. | every tx confirmed; `verify` passes on the test deployment; afterwards the commit-13 tree is unchanged (`jj diff --from <commit 13> --to @` empty, the commit-13 id unchanged); results recorded in the PR body, as in #116 |

## Oracles

Beyond the gate (testing layers, user 11-11):

- **L2 pure goldens:** (input record, frozen PlanningContext) → TxPlan per
  command, no chain.
- **L3 ledger acceptance:** construct, then the Blaze emulator applies it
  (`expectValidTransaction`).
- **tx-id equality against the reference.** `ouwrttzy` in /tmp/mrc-land is
  checked out read-only. For each transaction command, the same UTxOs on
  the emulator must give the same tx id. This is the main guard against
  behaviour drift. Possible exception: mint-tcnight (row 30) moves from
  provider evaluation to the local VM under the frozen context, so its
  ex-units, and therefore its id, may differ; if they do, the commit
  records why.
- **Byte-identical** `just build` and bindings.
- **Read-only live output** of `info`/`verify` diffed against the
  reference. This is manual QA, and needs a go before it runs against a
  network.
- **L4 size/ex-unit budget tests:** later (user, 11-11).

## Guardrails

- jj only; no push; no `sign-and-submit` or `combine-signatures` against a
  network except in step Q, with the user's go before each submission; no
  Aiken source, `aiken.toml` or `aiken.lock` change.
- Tests call functions, never the CLI binary; submitting to a network is
  manual QA, never a test; no Effect TestClock (`it.live`).
- `pnpm-lock.yaml` is regenerated from scratch whenever `package.json`
  changes, with everything at the latest version in range that is at least
  48 h old (`minimumReleaseAge: 2880` in `pnpm-workspace.yaml`).
- A deviation from this plan is recorded in the commit that makes it and
  here.

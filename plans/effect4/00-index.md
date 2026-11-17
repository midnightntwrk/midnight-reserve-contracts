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
| Type check | `tsc --noEmit` (TypeScript 6) in `just check` and CI; `vp check` keeps oxlint's type-aware rules (`typeAware`, through oxlint-tsgolint) with `typeCheck` off (D8) |
| CI | `voidzero-dev/setup-vp` at an exact release, pinned by SHA; then `vp check`, `tsc --noEmit`, `vp test` |

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
  instead of prettier) and `vp check` (TypeScript 7 instead of `tsc`; D8
  brings `tsc` back for type errors); CI on
  `setup-vp`. Bun leaves the project. New orgs: voidzero-dev (vite-plus),
  oxc, pnpm.
- **Plan purity (user, 11-11): review-only.** `plan*` functions take no
  services and no Blaze; review enforces it, not lint.
- **D8 TypeScript 6 type check (user, 11-15 14:27 and 14:31), in the
  commit after 1.** `typescript` ^6.0.3 as a devDependency, matching main;
  `just check` and CI run `tsc --noEmit`. Oxlint's `typeCheck` is off, so
  TypeScript 7 no longer reports type errors; `typeAware` stays on, and
  oxlint-tsgolint stays for the type-aware rules (the user's exception).

## Dependency rules (lint, from commit 1)

Every file of `cli/`: no `fs` or `child_process` (FileSystem and
ChildProcess), no `throw` or `try`, no `process.exit` or `process.env`, no
Effect runners, no `fetch` global, and relative imports in canonical form
(`./a/b`, no extension) so the rules below cannot be dodged. In `cli/` and
`tests/`: no `bun`, `bun:*` or `@effect/platform-bun` import and no `Bun`
global. A rule may name a module that does not exist yet.

| Module | Rule |
|---|---|
| `tx.ts` | imports no `cli/` module but `errors` (commit 5: compile takes no service; everything it reads is in its `TxPlan` and `PlanningContext`) |
| `signing.ts` | imports no `contracts/**` |
| `keys.ts` | imported only by `signing.ts` and `main.ts` |
| `ProviderConfig` | named by no module but `chain.ts` |
| `contracts/snapshot-write.ts` | imported only by `deploy.ts`, `governance/two-stage.ts` |
| `contracts/snapshot-read.ts` | imported only by `contracts/**` (commit 4: a command reads the record through `ContractResolver`) |
| `contracts/build.ts` | imported only by `commands.ts`, `contracts/snapshot-write.ts` |
| `contracts/snapshot-read.ts`, `contracts/snapshot-write.ts` | import no `output` |
| Blaze | `@blaze-cardano/sdk` and `@blaze-cardano/tx` are imported only by `tx.ts` (commit 3: `chain.ts` uses neither, and `Provider` has no `blazeFor`) |

Plans (`plan*`) take no services; with plans living beside their commands in
L1 that is a review rule, not a module rule.

The three rules that dated from the architecture before the 11-11
revision are settled: the `blazeFor` rule in commit 3, the
`contracts/snapshot-read.ts` importers in commit 4 and the `tx.ts`
boundary in commit 5.

## Commits

Every commit passes the gate `just fmt && just build && just check && vp
test` with no diff produced by the gate, and leaves Aiken and
`plutus*.json` untouched. `just build` runs `vpx cli/main.ts build`.

| # | Commit | Adds | Verified by |
|---|---|---|---|
| 0 | plans(effect4) | this architecture, the dependency rules, the commit plan, the oracles | the user's review |
| 1 | cli: Effect 4 switch with `build` | deletes `cli-yargs/` and every test that imports it. Deps: effect and @effect/platform-node ^4.1.3, vitest 5.1.0, @effect/vitest ^4.1.3; drops yargs, @types/yargs, cbor, globals, eslint, prettier and typescript; keeps toml. main.ts, errors, input, Output. `Profile` (config.ts). contracts/build.ts (build engine + bindings, via ChildProcess for aiken) and the `build` command; `generate-key`. Node 26, pnpm and Vite+ (D7): no package.json scripts; the Justfile `build`, `cli`, `use-env`, `fmt` and `check` recipes call `vp`/`vpx`. CI runs `vp check` and `vp test` through setup-vp. CLAUDE.md gate line; surviving tests converted to vitest. Dependency rules in oxlint: vite.config.ts plus the `mrc` JS plugin (ported from the reference `eslint.config.js`, adapted to the L1 modules). pnpm `minimumReleaseAge` 2880 and the type-fest packageExtensions fix | **Build output equal to the reference's**, per profile, in fresh scratch trees: every file either writes, including `contract_blueprint.ts`, which a non-default build overwrites by design (reference `cli/contracts/build.ts:39-47`). Only the default build (the gate's `just build`) must leave the tree clean. Also: build-engine tests (intent of `tests/build-engine.test.ts`); generate-key and input tests; 42 planted lint violations fire (throwaway); the CI steps reproduced |
| 1a | tooling: TypeScript 6 type check | typescript ^6.0.3 (devDependency); `just check` and CI run `tsc --noEmit`; oxlint `typeCheck` off, `typeAware` and oxlint-tsgolint kept (D8); pnpm-lock.yaml regenerated | `tsc --noEmit` clean on this commit and on every later one; gate |
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
| Q | **Live QA on preview** (user, 11-11): not a commit; runs after 13, before the PR opens. Anything it finds is fixed in the commit it belongs to. **The test deployment is temporary** (user, 11-11): afterwards the old preview record is restored. Q runs in a fresh empty change on top of commit 13, so every file it writes lands only in that change. Q begins with `just build preview` in that change (LEAD, 11-17), so the full deploy reads a fresh build: the committed preview build predates cNIGHT minting (2026-01-23) and has no cNIGHT minting validators. The restore drops the regenerated `aiken.toml`, `plutus-preview.json` and bindings with the rest; refreshing the committed network builds is outside the series. Afterwards that change is restored to its parent (`jj restore`, i.e. back to commit 13) and abandoned. This keeps the series' own intended record changes (e.g. row 79 drops `beefy_signer_threshold.else` from deployed-scripts/preview); restoring to the pre-series base would undo them. None of the run's record writes enter any commit. | Read-only `info`/`verify` on preview and mainnet. Then submitted on preview: a fresh test deployment (12 governance txs + cNIGHT minting), `verify`, `register-gov-auth`, `mint-tcnight`, one `change-*` command, and a stage → promote cycle on that test deployment. The worker builds, signs and submits with the preview keys from the user's .env (copied into its workspace; gitignored, never committed), and **asks for the user's go before each submission**. | every tx confirmed; `verify` passes on the test deployment; afterwards the commit-13 tree is unchanged (`jj diff --from <commit 13> --to @` empty, the commit-13 id unchanged); results recorded in the PR body, as in #116 |

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

## Deviations

Commit 1:

- `cli/output.ts` holds `Output`: L1 gave it no file, and every program
  (contracts/build.ts among them) needs it, so it cannot live in main.ts.
- `toml` stays a dependency: `Profile` parses aiken.toml with it; Node has
  no TOML parser of its own.
- `mainnet_merge_transactions.test.ts` survives: its helper imported
  `cli-yargs` only to read aiken.toml, which `Profile`'s parser now does.
- No package.json scripts: the `vp` built-ins and the Justfile cover them.
- `@effect/platform-node` is imported by module (`/NodeRuntime`,
  `/NodeServices`): its barrel loads NodeRedis, which needs `redis`. The
  `redis` peer is marked optional (`packageExtensions` in
  `pnpm-workspace.yaml`), so pnpm does not install it.
- `vite-plus` 1.5.1 and `vitest` 5.1.0 are exact, through the
  `pnpm-workspace.yaml` catalog with `vite@*`/`vitest@*` overrides: Vite+'s
  rule for one Vitest copy. Everything else is a caret range.
- `@cardano-sdk/util`'s published types import type-fest's `Tagged`, but
  its manifest lists type-fest only as a devDependency. Unresolved, under
  `skipLibCheck`, every Cardano SDK opaque type (`PaymentAddress`,
  `TransactionId`, `Hash28ByteBase16`, ...) was `any`, in the reference
  too. `packageExtensions` gives it type-fest ^4.41.0, and
  `mainnet_merge_transactions.test.ts` now wraps its script hash in
  `Hash28ByteBase16`.
- The Blaze rule bans all of `@blaze-cardano/sdk` and `@blaze-cardano/tx`
  outside `tx.ts` and `chain.ts`. The reference used `calculateMinAda` and
  `calculateRequiredCollateral` from `@blaze-cardano/tx` in plan and deploy
  modules; here those go through `tx.ts`.
- ESLint's `no-restricted-syntax` (throw, try, canonical imports,
  `blazeFor`) is the `mrc` JS plugin in `lint-plugin.js`; Oxlint has no
  such rule. Oxlint's default correctness category and its type-aware
  rules also run.
- Format and lint cover `cli/` and `tests/`, as prettier and eslint did;
  oxfmt does not re-include a root file after `/*`, so `vite.config.ts`
  and `lint-plugin.js` are outside `vp check`.

Commit 2:

- `parseSigners` and `parseCandidates` (with `Signer` and
  `PermissionedCandidate`) live in `input.ts`, not `datum.ts`: they parse
  environment text, and `input.ts` holds the boundary parsers. The datum
  codecs that encode them come with `datum.ts`.
- The aiken.toml profile tests of the reference's `tests/config.test.ts`
  land here; commit 1 brought `Profile` without them.

Commit 3:

- `ProviderConfig` is a value private to `chain.ts`, not a service:
  `Provider.layer` reads the credentials itself, so no other module can
  reach them. The lint rule on the name stays.
- `Provider` has no `blazeFor`: compile builds Blaze from the
  PlanningContext. Its two `blazeFor` lint selectors are gone, and
  `@blaze-cardano/sdk` and `@blaze-cardano/tx` are now refused in
  `chain.ts` too.
- The reward-account read (reference `chain/registration.ts`) is
  `Provider.rewardAccountRegistered`, so the Blockfrost key it uses stays
  in `chain.ts`.
- `@blaze-cardano/ogmios` ^0.0.8 is a declared dependency: Kupmios takes
  its client, and pnpm's strict layout does not expose it through
  `@blaze-cardano/query`.

Commit 4:

- `contracts/snapshot-read.ts` is imported only by `contracts/**`. A
  command reads the record through `ContractResolver` (`isPromoted`,
  `promotedAmong`, `liveHashOf`), so one module decides where contracts
  come from. `deploy.ts`, `governance/two-stage.ts` and `report.ts` lose
  their direct access; `snapshot-write.ts` stays theirs.
- `DeployedScripts` (where the record lives) is in `config.ts`, so
  `main.ts` can provide it without importing a record module.
- `ContractResolver.contracts("actsOn")` on local and the emulator reads
  the build. The reference refused there unless `--use-build` was given;
  the 11-11 architecture has no `--use-build` source toggle.
- A plutus.json is written back with its keys in the order it was read
  (aiken's: preamble, validators, definitions). The reference decoded it
  through its schema, which moved `preamble` last.
- `build --components` without `--from-deployed` is an InputParseError
  from the build, not effect/cli's validation error with help.
- The record reads only commands 7 and 11 use (`readRecord`,
  `validatorNameByHash`, `buildValidatorNameByHash`, `isTrackLogic`) and
  the stage and promote record steps come with those commands.

Commit 5:

- compile always evaluates scripts on the local Blaze VM with the
  context's parameters. The reference ran the local VM as an advisory
  check and fell back to the provider's evaluation when it failed; a
  failure is now a TxBuildError with the traces.
- compile prints nothing; the command prints "Building transaction" and
  the transaction id. `tx.ts` therefore imports no `output`.
- The coin selection guard (no reserved UTxO, no UTxO carrying a
  reference script) filters the context's wallet UTxOs in compile; the
  reference did it in a `ColdWallet` subclass in the provider.
- `CompileOptions` is gone: the command name is in `PlanningContext`,
  and metadata, fee padding and the expected vkey witnesses are in
  `TxPlan`.
- Building a `PlanningContext` from the services (parameters and wallet
  UTxOs from `Provider`, reserved refs from `Profile`, contracts from
  `ContractResolver`) comes with the first transaction commands (commit
  8), with `reservedRefs` and its tests. So do the script helpers
  (`logicRedeemer`, `mintWitnesses`, `withdrawThroughLogic`,
  `createRewardAccount`, the `calculateMinAda`/`calculateRequiredCollateral`
  re-exports); this commit has the CIP-20 metadata compile uses.

Commit 6:

- Submission with retries and the confirmation wait (reference
  `chain/submit.ts`) live in `signing.ts`, beside their only callers.
  `Provider.submit` stays one attempt. `chain.ts` exports the retry
  helper (`retrying`, generalised from the read retry) so both share one
  policy.
- Signing and witness-file verification both go through
  `@cardano-sdk/crypto` (libsodium), for normal and extended keys. The
  reference verified with `@noble/curves` (`zip215: false`); libsodium's
  verify is the one the ledger uses, and it refuses the small-order key
  that ZIP-215 accepts. `@noble/curves` is not a dependency.
- The transaction file is written by `signing.ts` through FileSystem;
  `Output` gains the marked lines (`success`, `info`, `progress`) but no
  file writing. Written files are byte-identical to the reference's for
  the same transaction and keys (`tests/golden/signing/`).
- The deployment-file schema here only reads `transactions`; the writer
  comes with deploy (commit 12).

Commit 7:

- verify reads the record through `ContractResolver.record`, whose
  validators carry their names, so `report.ts` imports no snapshot module.
- `governance/two-stage.ts` and `datum.ts` start here with what info and
  verify need (the NFT names, `findMainUtxo`, the UpgradeState decode,
  `isTrackLogic`, the inline-datum decode); the rest comes with their
  commands (9–11).
- verify's UpgradeState check is an Effect: Effect 4's `Result` has no
  `try`, so the datum decode is `Effect.try`. The checks still read no
  service.
- info and verify write their files through FileSystem in `report.ts`;
  `Output` has no file writing (commit 6).
- `info --use-build` shows the build (`contracts("creates")`); without it,
  the record (the build on local and the emulator, commit 4).
- dust-participants has no `--use-build`: the architecture keeps the flag
  only for info and promote. It reads `cnight_generates_dust` from the
  record.

Commit 8:

- `planningContext` (parameters, the wallet's UTxOs, the profile's
  reserved refs, slot config, network, contracts, resolved inputs) and
  `deployerUtxo` live in `chain.ts`, beside the reads they make;
  `reservedRefs`, `slotConfigOf`, `addressOn` and `envOr` in `config.ts`;
  the script helpers (`createRewardAccount`, `logicRedeemer`,
  `withdrawThroughLogic`, `minAda` over Blaze's `calculateMinAda`) in
  `tx.ts`. A plan takes its PlanningContext (`planX(ctx)`, inputs in
  `ctx.resolved`).
- merge-utxos is in `wallet.ts` with the other row-8 commands, not in
  `governance/`.
- The commands print the reference's build lines ("Building
  transaction...", the local check when the plan spends, references or
  offers UTxOs, "Transaction built: <id>") from `compileReported`, first
  in `wallet.ts` (commit 9 moves it to `signing.ts`).
- mint-tcnight and merge-utxos have no `--use-build` (the architecture
  keeps it for info and promote only): they act on the record, or on the
  build on local and the emulator.
- `--count`/`--amount` fall back to SIMPLE_TX_COUNT/SIMPLE_TX_AMOUNT in
  the program (`envOr`): a bad value is a ConfigError naming the
  variable, not a flag error. `--burn` with `--destination` is an
  InputParseError from the program, before any read; the reference
  refused it at flag parsing.
- mint-tcnight's closing hint names `just cli sign-and-submit` (the
  reference: `bun cli`).
- Tx ids against the reference on one emulator state (same UTxOs, same
  default build): simple-tx, the burn and merge-utxos are identical; the
  mint differs as row 30 foresaw: the reference had the provider evaluate
  a plan with no spends (ex units mem 5245, steps 3539866), compile runs
  the local VM with the 1.2 margin (6294, 4247839), so the fee is 112
  lovelace higher. Inputs and outputs are the same.

Commit 9:

- `compileReported` moves from `wallet.ts` to `signing.ts` (LEAD, 11-17):
  compile then write is one output pipeline, and `signing.ts` already
  prints the "Transaction written to" line. No new file.
- The datum codecs (signers, terms, FederatedOps, logic_round) are one
  `datum.ts`, as L1 lists it; they return `Result` where they cannot
  throw and `Effect` where Blaze's CBOR reader or `parse` can. The
  threshold rule, the signer and threshold readers and the native-script
  witnesses are in `governance/multisig.ts` with change-council and
  change-tech-auth; the governed forever update with change-terms and
  change-federated-ops in `governance/forever.ts`.
- `scriptUtxos` and `firstUtxoAt` live in `chain.ts`, `mainUtxoAt` and
  `twoStageLogic` in `governance/two-stage.ts` (the reference's
  `contractUtxos` record). The PlanningContext's `contracts` are the
  blueprint's own list; wallet.ts's `namedContracts` copy is gone.
- The four commands have no `--use-build` (the architecture keeps it for
  info and promote only): they act on the record, or on the build on
  local and the emulator. The flags are otherwise the reference's, in its
  help order.
- TxPlan has no `requiredSignatures`: the program counts the witnesses
  (`witnessCount` in `signing.ts`) and the plan carries
  `expectedWitnesses`, read from its resolved inputs.
- L3 submits the files unsigned (`--no-sign`), then sign-and-submit adds
  the deployer: the Blaze emulator does not run native scripts, so it
  refuses the authorities' vkey witnesses as extraneous ("has not been
  consumed"); the real ledger takes them. A separate test checks that a
  signed file carries one witness from each authority key over the same
  transaction id.
- Against the reference on one emulator state (signed with both
  authorities, as by default): the transaction CBOR, so the id, and every
  printed line are identical for all four commands.

Commit 10:

- Placement: migrate-federated-ops and mint-staging-state (the v2 logic
  track) are in `governance/staging.ts`; register-cnight-mint-logic and
  run-cnight-mint-mainnet in `governance/cnight.ts`; register-gov-auth in
  `governance/two-stage.ts`, beside the gov auth every upgrade runs
  through. `ensureRegistered`, `refuseRegistered`, `deployerUtxoAt` and
  `profileCollateral` are in `chain.ts`, through
  `Provider.rewardAccountRegistered` (commit 3); `requiredCollateral` over
  Blaze's `calculateRequiredCollateral` is in `tx.ts` (the Blaze rule).
- The plan row's "run-cnight-mint(-mainnet)" is one command,
  run-cnight-mint-mainnet, as in the reference.
- None of the five commands has `--use-build`. migrate-federated-ops,
  register-gov-auth and run-cnight-mint-mainnet act on the record, or on
  the build on local and the emulator. mint-staging-state reads the
  build (`contracts("creates")`): its v2 logic and staging forever are not
  deployed until promoted. register-cnight-mint-logic follows the
  per-intent rule through `ContractResolver.toRegister` (LEAD, 11-17):
  registering the credential of a logic the record holds acts on it and
  reads the record; one the record does not hold yet is a creation and
  reads the build (every record but mainnet's lacks the cNIGHT mint
  logic). Local and the emulator read the build. The reference needed
  `--use-build` for the second case.
- StakeNotRegistered ends with `just cli register-gov-auth -n <env>` (the
  reference: `bun cli/index.ts`).
- L3 submits mint-staging-state unsigned, as commit 9's commands: the
  Blaze emulator refuses the tech authority's vkeys as extraneous.
- The registration checks are tested at function level with a Provider
  that answers `rewardAccountRegistered`. Through sign-and-submit the
  Blaze emulator cannot show a refused re-registration: its
  `acceptTransaction` puts the transaction in the mempool and then applies
  the certificates, which throw "already registered", so the submit
  fails; but the mempool entry stays, and submitTransaction's recovery
  (`isConfirmed`, i.e. `awaitTransactionConfirmation`) produces a block
  from it, and the run reports "Transaction already confirmed on-chain".
- Against the reference on one emulator state: migrate-federated-ops,
  mint-staging-state, register-cnight-mint-logic and
  run-cnight-mint-mainnet give the same transaction CBOR, so the same id,
  and every printed line the same. register-gov-auth differs as
  mint-tcnight did in commit 8 (row 30): a plan with no spends was
  evaluated by the reference's provider (ex units 24169/7060496 and
  24569/7124496), here by the local VM with the 1.2 margin (29003/8472595
  and 29483/8549395), so the fee is 767 lovelace higher. Inputs, outputs
  and certificates are the same.

Commit 11:

- stage-upgrade and promote-upgrade are in `governance/two-stage.ts`
  (one of the two importers of `contracts/snapshot-write.ts`), with the
  UpgradeState transitions and the record updates; the governance
  authority (`governanceAuthorityPlan`, `resolveAuthority`) is in
  `governance/multisig.ts` with the other multisig pieces. two-stage.ts is
  about 850 lines, over L1's ~700, like report.ts and signing.ts.
- A plan reads the target's main and staging UpgradeStates from its
  resolved inputs (`TwoStageTarget.mainState`/`stagingState`), decoded by
  the program, so the plan is pure and cannot fail on a datum. The
  reference's `scriptRef` option (always None) is gone.
- stage-upgrade has no `--use-build`: the validator's contracts, the
  forevers, the staging threshold and gov auth come from the record (the
  build on local and the emulator): row 17. The logic is looked up in the
  record, else in the build (`ContractResolver.recordedNameOf` /
  `builtNameOf`); a build-only logic is copied into the record. Refused up
  front: a hash in neither (LogicNotFound, row 19), a build logic whose
  name the record promotes under another hash (PromotedLogicMoved).
- promote-upgrade keeps `--use-build` for the staged-logic lookup only (the
  script it registers); everything else comes from the record.
- Local and the emulator keep no record, so stage and promote write
  nothing there and print no "Could not track" warning (row 18); the
  reference tried and warned.
- The main authority reads only the two forevers and the main gov
  threshold; the council two-stage main is read only for the staging
  authority.
- `Output.stderr` (a plain line on stderr) carries the record warning.
- Against the reference on one emulator state (signed with both
  authorities): stage-upgrade 781d0221… and promote-upgrade e4226870…
  give the same transaction CBOR; the output is the same but for the
  reference's "Could not track" warning on the emulator.

Commit 12:

- `cli/deploy.ts` holds deploy and deploy-staging-track: the steps, one
  `planDeployment` over a tagged `Deployment` (two-stage, cNIGHT minting,
  or a single NFT: a threshold or a staging forever), and the run they
  share. It is about 980 lines, over L1's ~700.
- The transactions are a fold over the PlanningContext: each step is
  planned and compiled in the context the previous one leaves
  (`afterTransaction` in tx.ts: the wallet without what it spent, with the
  change it paid back); the one-shots and the collateral are found among
  the first context's wallet UTxOs (`utxoAmong`, `collateralAmong` in
  chain.ts), so a deploy reads the chain twice (parameters, the deployer's
  UTxOs). With one-shots that pay their own way the transactions are the
  reference's; with one-shots too small, each spends the change of the one
  before, where the reference's would all spend the same wallet UTxO.
- sign-and-submit submits every transaction of a file before it waits;
  a node takes a chain from its mempool, the Blaze emulator does not, so
  the chained-deploy test submits one transaction at a time.
- The four threshold flags fall back to their variables in the program
  (`envOr`), as simple-tx's do (commit 8).
- "Deployment scripts saved to" names the record directory relative to
  the repository root, not the working directory.
- Against the reference on one emulator state (a full deploy, a
  cnight-minting deploy, the staging track): every one of the 19
  transactions has the same CBOR, and the output is the same.

Commit 13 (LEAD, 11-17):

- docs/architecture/cli.md is the one page of this architecture (the
  flow, services, contract sources, record, layout, dependency rules,
  tests, toolchain). docs/architecture/contracts.md and testing.md come
  from the docs/architecture bookmark (c5630b51), as the plan says (user,
  11-14; LEAD reversed a brief instruction to leave them out): contracts.md
  with its build and promote references moved from cli-yargs to
  cli/contracts/build.ts, cli/governance/two-stage.ts and cli/tx.ts (and
  `build --from-deployed`, which pins and runs the phased build), testing.md
  with the counts, rules, goldens and emulator acceptance of this CLI
  (vitest 331 tests in 25 files, 34 plan goldens) and its gate and CI
  steps. The staking line's later edits to those pages rebase on top.
- The live deployment runbook moves from `.claude/docs/live-deployment.md`
  to `docs/governance/runbook.md`, rewritten for this CLI (no
  create-witnesses.ts; combine-signatures takes cardano-cli or CIP-30
  witnesses; stage-upgrade has no `--use-build`). docs/governance/upgrade.md's
  stage/promote example uses the real flags.
- Removed: `.claude/docs/` (its lasting content is in cli.md, the runbook
  and the README), `plans/effect/` (the Effect 3 plans) and the unused
  root `extract-witnesses.ts` (row 53). `plans/effect4/` stays until the
  PR, while the series is in flight.
- README: quick start (vp install, just build, just check, vp test, just
  cli --help, the .env values), the project structure with `cli/` and
  `deployed-scripts/`, and the command table of all 23 commands; Maestro
  and the unknown-environment fallback are gone (neither exists).
- CLAUDE.md's Additional Docs point at cli.md and the runbook.

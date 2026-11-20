# CLI architecture

The CLI (`cli/`, run as `just cli <command>`) builds the governance
transactions of the Midnight contracts on Cardano: it reads the chain and
the contract record, plans each transaction as data, completes it with
Blaze, and writes it to a file for offline signing. Only `sign-and-submit`
and `combine-signatures` submit. It is written on Effect 4 (`effect`,
`effect/cli`) and runs on Node through Vite+.

## Flow

```
argv ─► effect/cli Command ─► typed input (parsed at the boundary)
   │
   ▼  resolution: the only layer that does I/O
   │    Profile (aiken.toml), DeployerAddress, Keys (signing only)
   │    ContractResolver: the build or the deployed record, by intent
   │    Provider: named chain reads, parameters, submit, isConfirmed
   ▼
PlanningContext: frozen data (the command's resolved inputs, protocol
   │             parameters, wallet UTxOs, reserved refs, slot config,
   │             contracts for trace labels)
   ▼  pure from here down
plan(ctx) ─► TxPlan (+ RecordUpdate)   no services, no Blaze
compile(plan, ctx) ─► Transaction      the only TxBuilder user
   ▼  effects again
apply RecordUpdate ─► write the file (signed with Keys when asked) ─► submit (sign-and-submit only)
```

- A plan takes its context (`planX(ctx)`, inputs in `ctx.resolved`) and
  nothing else: no service, no Blaze, no chain read. Review enforces it.
- `compile` (cli/tx.ts) is the only place a Blaze `TxBuilder` exists. It
  draws coin selection from the context's wallet UTxOs, never from a
  reserved reference (the profile's one-shots and collateral) or a UTxO
  that carries a reference script; it evaluates scripts on the local Blaze
  VM with the context's parameters (1.2 margin on ex units); it checks the
  size the transaction will have with its vkey witnesses. Blaze changes
  the objects it is given, so compile hands it CBOR copies: compiling the
  same plan and context twice gives the same transaction.
- Chained transactions (deploy, deploy-staging-track) are a fold: each is
  planned and compiled in the context the previous one leaves
  (`afterTransaction`: the wallet without what it spent, with the change
  it paid back), with no chain read in between.
- Reads are not cached: a run makes a handful of reads, each on use. The
  one provider connection of a run is shared.

## Services

| Service | Holds |
|---|---|
| `Profile` | the environment's aiken.toml profile: one-shots, collateral, cNIGHT policy |
| `DeployerAddress` | the deployer address, checked against the environment's network |
| `Keys` | signing keys, read only by `signing.ts` and `main.ts` |
| `Provider` | named reads, parameters, submit, isConfirmed over Blockfrost, Kupmios or the emulator; credentials stay in `chain.ts` |
| `ContractResolver` | the build output and the deployed record behind the source rule below; never builds |
| `DeployedScripts` | where the environment's record lives (`deployed-scripts/<env>/`) |
| `Output` | every line a command prints; logs go to stderr, outside it |

The runtime edge (`main.ts`): `NodeRuntime.runMain`, `NodeServices.layer`,
`FetchHttpClient.layer`, and the process environment with `.env` as the
fallback. `LOG_LEVEL` (an Effect level name in any case, or the Effect 3 CLI's `Warning` and `OFF`; Info when unset)
sets the minimum log level, and logs (`Effect.log*`) go to stderr, so stdout
carries only what `Output` prints (`info --format json`); a bad `LOG_LEVEL`
is a `ConfigError` that fails every command, reported like any other. Help is
effect/cli's own.

## Which contracts a command reads

`ContractResolver.contracts(intent)`:

- A command that **acts on** deployed contracts reads the record
  (`deployed-scripts/<env>/`): every governance change, migration, merge,
  registration, report and stage-upgrade's forevers, threshold and gov auth.
- A command that **creates** contracts reads the build (`plutus-<profile>.json`,
  `contract_blueprint_<profile>.ts`): deploy, deploy-staging-track,
  mint-staging-state's v2 logic and staging forever.
- local and the emulator keep no record and read the build.
- A stake registration reads the record when it holds the script, else the
  build (`toRegister`).
- stage-upgrade looks the new logic up in the record, else the build, and
  copies a build-only logic into the record.
- `--use-build` exists only on `info` (what to show) and `promote-upgrade`
  (where to find the staged logic it registers).

## The record

`deployed-scripts/<env>/` (plutus.json, contract_blueprint.ts,
versions.json, changelog.json) is the manifest the CLI keeps of what it
deployed; the chain is the truth, which `verify` checks it against. A
command prepares its RecordUpdate before any chain read and writes it after
compile, before the transaction file, so a record that cannot be written
leaves no file to sign.

- A full deploy on a test environment replaces the record with the build.
- A `--components` deploy, deploy-staging-track, and any deploy on preprod
  or mainnet extend it with what they create; their UpgradeState datums
  name the gov auths the record promotes. On preprod and mainnet a
  validator the record already promotes is refused before any chain read.
- stage-upgrade tracks the validator as staged; promote-upgrade as
  promoted.

## Layout

| File | Holds |
|---|---|
| `main.ts` | argv, the command tree, the runtime edge's layers, runMain |
| `commands.ts` | every Command: its flags, parsed at the boundary, its program, and the service layers that program needs |
| `input.ts`, `errors.ts`, `output.ts` | boundary parsers and brands; tagged errors and their text; Output |
| `config.ts` | Profile, DeployerAddress, the environment values commands read |
| `keys.ts` | Keys |
| `chain.ts` | Provider, the PlanningContext read, UTxO and registration lookups |
| `tx.ts` | PlanningContext, TxPlan, compile, trace labels, script helpers |
| `signing.ts` | transaction files, signing, compileReported, sign-and-submit, combine-signatures |
| `datum.ts` | datum codecs: signers (duplicate keys kept), terms, FederatedOps, logic_round |
| `contracts/` | `resolver.ts` (ContractResolver), `snapshot-read.ts`, `snapshot-write.ts` (RecordUpdate), `build.ts` (aiken build and bindings) |
| `governance/` | `multisig.ts` (thresholds, witnesses, authority, change-council/-tech-auth), `forever.ts` (change-terms, change-federated-ops), `two-stage.ts` (UpgradeState, stage/promote, register-gov-auth), `staging.ts` (mint-staging-state, migrate-federated-ops), `cnight.ts` (cNIGHT registration and run) |
| `deploy.ts`, `wallet.ts`, `report.ts` | deploy and the staging track; simple-tx, mint-tcnight, merge-utxos, generate-key; info, verify, dust-participants |

Adding a command: a program in the module of its concern (resolve, build
the PlanningContext, plan, `compileReported`, write), and a `Command` in
`commands.ts`.

## Dependency rules

Enforced by oxlint (`vite.config.ts` and the `mrc` plugin in
`lint-plugin.js`). Every file of `cli/`: no `fs` or `child_process`
(FileSystem and ChildProcess), no `throw` or `try`, no `process.exit` or
`process.env`, no Effect runners, no `fetch` global, relative imports in
canonical form. In `cli/` and `tests/`: no Bun.

| Module | Rule |
|---|---|
| `tx.ts` | imports no `cli/` module but `errors` |
| `signing.ts` | imports no `contracts/**` |
| `keys.ts` | imported only by `signing.ts` and `main.ts` |
| `contracts/snapshot-write.ts` | imported only by `deploy.ts` and `governance/two-stage.ts` |
| `contracts/snapshot-read.ts` | imported only by `contracts/**` |
| `contracts/build.ts` | imported only by `commands.ts` and `contracts/snapshot-write.ts` |
| `contracts/snapshot-read.ts`, `contracts/snapshot-write.ts` | import no `output` |
| `ProviderConfig` | named by no module but `chain.ts` |
| `@blaze-cardano/sdk`, `@blaze-cardano/tx` | imported only by `tx.ts` |

## Tests

Tests call functions; none spawns the CLI or touches a network. Submitting
to a network is manual QA. The layers, and what exists of each, are in
[testing.md](testing.md); the contracts the CLI builds for, in
[contracts.md](contracts.md).

- Plans are checked as data from a frozen context; the goldens under
  `tests/golden/` were written by the Effect 3 CLI the rewrite replaced,
  for the same inputs.
- Each command's transaction is built over the Blaze emulator and
  submitted through `sign-and-submit`. The emulator does not run native
  scripts, so files carrying authority witnesses are submitted unsigned
  there; and it takes no transaction spending from its mempool, so chained
  transactions are submitted one at a time.
- `it.live` everywhere: no TestClock.

## Toolchain

Node (the version in `package.json` `devEngines`, not enforced), pnpm, Vite+: `vp install`,
`vp test` (vitest with `@effect/vitest`), `vp check` (oxlint, oxfmt),
`vp exec tsc --noEmit` (TypeScript 6). Dependencies change through
`vp add` / `vp remove`, never by editing versions in `package.json`; a
version is adopted only once it has been published for 48 hours
(`minimumReleaseAge` in `pnpm-workspace.yaml`).

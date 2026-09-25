# Phase 03 — Read-only and local commands

Goal: the commands without transaction submission, lowest risk, one
commit each.

| Command | Lines | Notes |
|---|---|---|
| `generate-key` | 61 | done in phase 01 |
| `build`, `build-from-deployed` | 135 | `build-engine` Effect API; `just build` unchanged |
| `dust-participants` | 141 | Schema-parsed input file |
| `simple-tx` | 108 | first `Provider` + `complete-tx` consumer; writes the tx file, no submit |
| `verify` | 733 | pure checks over blueprint + on-chain UTxOs; `Effect.all` with `concurrency: 4` for the address fetches; the existing `tests/verify-schema.test.ts` (now `tests/json-files.test.ts`, phase 08) and `output-format.test.ts` move |
| `info` | 650 | `fetchAddressUtxos` bare `catch {}` becomes `UtxoNotFound` handled per contract; markdown report stays pure |

Pattern for every command file:
```ts
export const program = (argv: XOptions) => Effect.gen(function* () { ... });
export async function handler(argv: XOptions) { return runCommand("x", argv, program(argv)); }
```
`program` is what tests call (phase 06), `handler` is what yargs calls.
(Superseded by plan 09: `@effect/cli` commands, input parsed at the
boundary into a typed record, no `handler` and no `runCommand`.)

## Record (2026-09-25)
The goldens under `tests/golden/` split in two: `info` (deployed
blueprint, no chain) is asserted by `tests/info-golden.test.ts`; `verify`,
`dust-participants`, `simple-tx` and `register-gov-auth` read Blockfrost
or were captured on preview, so they are the reference for the preview
live check, not offline fixtures. Phase 08 task 4 (`HttpClient` with a
test layer) makes `verify` and `dust-participants` assertable offline; the
golden tests land there (still open: picked up by plan 06 task 1).
`simple-tx`'s builder is `buildSimpleTx` in `lib/simple-tx.ts` with an
emulator test (superseded: it is not exported and no test calls it
directly; see plan 06 task 4).

Recorded 2026-09-26 (user decision): `verify` checks the deployed record
(`deployed-scripts/<env>/plutus.json` and `versions.json`) against the
current unspent outputs at the record's scripts, read through the
Provider (`--provider` added), not against
`deployments/<env>/deployment-transactions.json` and its transaction
hashes: that file holds only the last run, so every check of the
components a `--components` run left out failed. Three pure checks: each
forever embeds its two-stage hash; each forever, two-stage main and
staging, and threshold NFT sits in exactly one unspent output at its
script; each UpgradeState names the record's gov auth and a logic of its
track (`<track>_logic` or `<track>_logic_v2`) that `versions.json`
promoted (main) or promoted or staged (staging).

`info`: a two-stage main datum that fails to parse is reported as
`upgradeState: null` and the report goes on, as before the port; the
command does not fail on one malformed datum.

## Acceptance
- Golden outputs (phase 06 step 1) unchanged for `info` and `verify`
  against the emulator snapshot.
- Commit per command: `effect(<command>): port to Effect`.

# Phase 03 — Read-only and local commands

Goal: the commands without transaction submission, lowest risk, one
commit each.

| Command | Lines | Notes |
|---|---|---|
| `generate-key` | 61 | done in phase 01 |
| `build`, `build-from-deployed` | 135 | `build-engine` Effect API; `just build` unchanged |
| `dust-participants` | 141 | Schema-parsed input file |
| `simple-tx` | 108 | first `Provider` + `complete-tx` consumer; writes the tx file, no submit |
| `verify` | 733 | pure checks over blueprint + on-chain UTxOs; `Effect.all` with `concurrency: 4` for the address fetches; the existing `tests/verify-schema.test.ts` and `output-format.test.ts` move |
| `info` | 650 | `fetchAddressUtxos` bare `catch {}` becomes `UtxoNotFound` handled per contract; markdown report stays pure |

Pattern for every command file:
```ts
export const program = (argv: XOptions) => Effect.gen(function* () { ... });
export async function handler(argv: XOptions) { return runCommand("x", argv, program(argv)); }
```
`program` is what tests call (phase 06), `handler` is what yargs calls.

## Acceptance
- Golden outputs (phase 06 step 1) unchanged for `info` and `verify`
  against the emulator snapshot.
- Commit per command: `effect(<command>): port to Effect`.

# Phase 06 — Tests

Goal: tests exercise `program` effects through one runtime helper;
helpers become layers; bun:test stays.

## Tasks

### 1. Goldens before any port (first commit of the whole migration)
For `info`, `verify`, `deploy --dry-run`, `simple-tx`: capture stdout and
written files against the emulator snapshot into
`tests/golden/<command>/`. Ports must reproduce them.

### 2. `tests/helpers/effect.ts`
```ts
export const runTest = <A, E>(layer: Layer.Layer<CliServices>, eff: Effect.Effect<A, E, CliServices>) =>
  Effect.runPromise(eff.pipe(Effect.provide(layer)));
export const EmulatorLive = (emulator: Emulator, env = "local") => Layer.mergeAll(ConfigLive(env), BlueprintLive(env), ProviderEmulator(emulator), OutputSilent);
export const expectFailure = <E extends CliError>(eff, tag: E["_tag"]) => ...   // asserts the tagged error, no string matching
```

### 3. Helpers as layers
`tests/helpers/deploy.ts` (`deployTechAuth`, `deployCouncil`, …) and
`upgrade.ts` return `Effect`s requiring `Provider`; `mainnet-snapshot.ts`
stays data.

### 4. Port by import
Tests that import only pure lib modules (`signers`, `candidates`,
`validation`, `redeemer-mapping`, `config-parsing`, `datum-versions`,
`versions`) change to `Either`/`Effect.runSync` in phase 02. Emulator
tests move with their command in phases 03–05 and, in the same commit,
stop hand-building the transaction: they resolve the snapshot or seeded
UTxOs, call the command's `build<Name>Tx` from `cli-yargs/lib/`, and run
`expectValidTransaction`. The assertion then covers the CLI builder and
the validator together; shape asserts against the test's own inputs are
not added back. `tests/bridge/**` is already independent of the CLI and
does not change.

Negative twins come with the builder: for each builder one test passes a
wrong input (missing second-authority witness for council/tech-auth,
stale staging round for promote, a merge output that drops cNIGHT) and
pins the withdrawal or spend failure text. The emulator does not evaluate
native-script signers, so witness tests assert the validator's rejection,
not signature satisfiability.

### 5. Error assertions
Replace `rejects.toThrow()` / message regexes with `expectFailure(eff,
"UtxoNotFound")`. Every tagged error class has at least one test that
produces it.

## Acceptance
- No `try`/`catch` in `tests/**` except inside `expectFailure`.
- `bun test` runtime not more than 1.5× today's (3.9 s).

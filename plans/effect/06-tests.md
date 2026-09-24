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
tests move with their command in phases 03–05. `tests/bridge/**` is
already independent of the CLI and does not change.

### 5. Error assertions
Replace `rejects.toThrow()` / message regexes with `expectFailure(eff,
"UtxoNotFound")`. Every tagged error class has at least one test that
produces it.

## Acceptance
- No `try`/`catch` in `tests/**` except inside `expectFailure`.
- `bun test` runtime not more than 1.5× today's (3.9 s).

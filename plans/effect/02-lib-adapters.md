# Phase 02 — `cli-yargs/lib` adapters

Goal: every lib module exposes Effect functions with typed errors; the
old Promise/throw exports are removed in the same commit as their last
caller moves (phases 03–05), so each module has a short period with both.

Note (2026-09-25): paths under `cli-yargs/` moved to `cli/<domain>/`
(plan 09 task 0).

## Order (leaf modules first; one commit each unless noted)

| Module | Lines | Change |
|---|---|---|
| `network-mapping.ts`, `protocol.ts`, `metadata.ts`, `types.ts` | 277 | pure; no change beyond types |
| `config.ts` | 414 | `Config` service impl; `requireBytesField` → `ConfigError` |
| `contracts.ts`, `blueprint-diff.ts`, `versions.ts` | 876 | `Blueprint` service impl; fs via `FileSystem`; `BlueprintError` |
| `signers.ts`, `candidates.ts`, `validation.ts` | 819 | Effect Schema for the JSON inputs (`parseSigners`, `parseCandidates`); CBOR encode/decode stay pure, decode returns `Either` |
| `datum-versions/*` | 665 | `parseUpgradeState` etc. → `Either<_, DatumParseError>`; the "logic_round not registered, falling back" log becomes a `Effect.logWarning` |
| `blockfrost.ts`, `provider.ts`, `governance-provider.ts` | 544 | `Provider` service impl; `getContractUtxos` → `UtxoNotFound`; `Effect.timeout` on every network call |
| `submit.ts` | 132 | `submitWithRetry` = `Effect.retry(Schedule.exponential(2s) ∩ recurs(3))` filtered on `retryable`; `awaitTxConfirmation` = `Effect.repeat` until confirmed with `Effect.timeout(5m)` |
| `complete-tx.ts`, `redeemer-mapping.ts` | 329 | two-phase evaluation as `Effect.either` on phase 1 (advisory) then phase 2; `TxBuildError` carries traces; no `console.error` (goes through `Output`) |
| `transaction.ts`, `transaction-json.ts`, `output.ts` | 380 | file writes via `FileSystem`; `Output` service impl |
| `build-engine.ts` | 871 | `aikenBuild` via `@effect/platform` `Command`; `AikenBuildError`; toml edits via `FileSystem`; the `MAX_VERIFY_ATTEMPTS` loop → `Effect.retry(Schedule.recurs(1))` |

## Record (2026-09-25)

Delivered as `Either` cores plus `Effect` readers with the services, but
not with the platform: `FileSystem`, `Command`, `Effect.timeout` on Blaze
calls, `retryable` classification, `Effect.logWarning` and Schema were
not done; the sync Node calls and `Bun.spawn` were wrapped in
`Effect.try`, and `submit.ts` classifies retries by message. No blocker
was hit; the deferral in the phase 01 follow-up was not picked up. Phase
08 completes these rows. Two deviations stand as decided: the
signer/candidate grammars are hand-written parsers (`pqnzqvkk`), and the
Blockfrost path already has a 30 s timeout and 5xx/429 `retryable`
(`pxqrylrs`).

Deviation (`mqxtnnmy`): the submit retry is 3 attempts in all
(`MAX_ATTEMPTS = 3` in `cli/chain/submit.ts`, `Schedule.recurs(2)`), not
`recurs(3)` (4 attempts) as the `submit.ts` row says.

## Rules
- A function that cannot fail returns a value, not `Effect`.
- Adapter boundary: every `Effect.tryPromise` names its error class in
  `catch`; `unknown` never crosses out of the adapter.
- Delete the 28 bare `catch {}` as their modules move; each becomes an
  explicit `Effect.catchTag` or a defect.

## Acceptance
- `grep -c "throw new Error" cli-yargs/lib` = 0 outside the pre-Effect
  blocks (each under a block `eslint-disable` and removed with its last
  caller in phases 05 and 07).
- `bun test` green throughout (tests that import lib modules move in
  phase 06 step 2 alongside).

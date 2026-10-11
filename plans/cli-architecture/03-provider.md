# Phase 03 — Provider with named methods

`Provider.use(op, (p: BlazeProvider) => Promise)` hands the raw Blaze
provider to any caller. Today it is used for three operations:
`getParameters` (`tx/compile.ts` twice, `deploy/deployment.ts`,
`governance/mint-staging-state.ts`, `wallet/mint-tcnight.ts`),
`postTransactionToChain` and `awaitTransactionConfirmation`
(`chain/submit.ts`).

## Tasks

1. Add to the `Provider` tag, each under the existing `PROVIDER_TIMEOUT`
   and `retryable` classification:
   - `parameters: Effect<ProtocolParameters, ProviderError | ConfigError>`;
     the first successful read is kept for the life of the `ProviderLive`
     layer (a run lasts minutes, not an epoch), a failed read is not
     kept. Not `Effect.cached`: it memoizes a failed `Exit` too. Use a
     `SynchronizedRef<Option<ProtocolParameters>>` and
     `SynchronizedRef.modifyEffect` (read when `None`, store on success),
     so concurrent first callers make one read. `buildTx` reads parameters
     twice per transaction today; a 12-transaction deploy with the local
     check would otherwise add 24 provider calls.
   - `submit: (tx: Transaction) => Effect<TransactionId, ProviderError | ConfigError>`
   - `isConfirmed: (txId: TransactionId) => Effect<boolean, ProviderError | ConfigError>`
     (one lookup, no wait; `chain/submit.ts` keeps its polling and retry)
2. Move the call sites; remove `use` from the tag (it stays a private
   helper inside `ProviderLive`).
3. `Provider.blaze` stays on the tag for now; phases 04–07 move its last
   callers into `tx/`, and phase 08 enforces it.
4. The cache is a small exported function in `chain/provider.ts`
   (`cacheSuccess(read): Effect<Effect<A, E>>`) that `ProviderLive` uses
   for `parameters`. Tests call it with a counting read:
   - concurrent first calls (`Effect.all(…, { concurrency: "unbounded" })`
     over a read with a real short delay) run the read once and all get
     its value;
   - a failing first read fails that call, and the next call reads again
     and succeeds.

One commit.

## Acceptance

- `grep -rn '\.use("' cli` is empty.
- `chain/submit.ts` behaviour unchanged: the submit tests (429 never hides
  a rejection, already-on-chain lookup, confirmation timeout) pass
  unmodified.
- The two `cacheSuccess` tests pass.

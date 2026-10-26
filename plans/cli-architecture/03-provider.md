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
   - `parameters: Effect<ProtocolParameters, ProviderError | ConfigError>`,
     read on each call (no cache: `buildTx`'s two reads per transaction
     are acceptable for this CLI)
   - `submit: (tx: Transaction) => Effect<TransactionId, ProviderError | ConfigError>`
   - `isConfirmed: (txId: TransactionId) => Effect<boolean, ProviderError | ConfigError>`
     (one lookup, no wait; `chain/submit.ts` keeps its polling and retry)
2. Move the call sites; remove `use` from the tag (it stays a private
   helper inside `ProviderLive`).
3. `Provider.blaze` stays on the tag for now; phases 04–07 move its last
   callers into `tx/`, and phase 08 enforces it.

One commit.

## Acceptance

- `grep -rn '\.use("' cli` is empty.
- `chain/submit.ts` behaviour unchanged: the submit tests (429 never hides
  a rejection, already-on-chain lookup, confirmation timeout) pass
  unmodified.

## Deviations

- `use` had a fourth caller the list above missed: `wallet/mint-tcnight.ts`
  built Blaze over the raw provider with the user's wallet
  (`use("Blaze.from", …)`). The tag gains
  `blazeFor(address): Effect<Blaze, …, Profile>` (a `GuardedWallet` at the
  address, the profile's UTxOs reserved, op `Blaze.from` as before). Read
  order is kept on both paths: `blazeFor` reads the profile before it
  connects, as mint-tcnight did; `blaze` connects, then reads
  DEPLOYER_ADDRESS, then the profile, as before.
  `blazeFor` leaves with `blaze` (phases 07/08).
- Two test call sites read through the named methods because `use` is
  gone: the `onChain` helper in `tests/emulator-confirmation.test.ts`
  (`isConfirmed`) and the refused-Ogmios case in `tests/effect-tx.test.ts`
  (`parameters`). Their assertions are unchanged.
- No read is memoized (user decision, see 00-index "Decisions taken"):
  `parameters` reads on each call, and the `Effect.cached` around
  `Provider.blaze`, `Profile.config` and `Blueprint.instances` /
  `Blueprint.contracts` is gone. Every command builds Blaze once, so
  `blaze` behaves as before. The provider connection stays shared for the
  run (opened on first use): the emulator's ledger and the one Ogmios
  socket depend on it.

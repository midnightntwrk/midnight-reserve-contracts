# Phase 06 — TypeScript (deferred)

Not started until phases 00–05 are green. Listed so the on-chain design
does not paint the tooling into a corner.

## Off-chain library `cli-yargs/lib/rewards/`
- `leaf.ts`: encode/parse reward leaves (spec §2.3).
- `merkle.ts`: sorted tree with promotion rule; `buildRangeProof(from, to)`
  producing the five-shape `ProofNodeRec` as Plutus `Data`; must reproduce
  the Aiken builder from phase 02 (share vectors as JSON under
  `tests/vectors/rewards/`).
- `mmr.ts`: positional MMR proof builder for test MMRs (keccak).
- `header.ts`: SCALE header encode for synthetic test headers with a
  rewards digest log.
- `digest-source.ts`: interface `getDigest(epoch) -> { digest, proof }`
  and `getLeaves(epoch)`; first implementation reads a JSON file; later a
  midnight-node RPC client.
- `list.ts`: read the deposit list from the provider (by NFT policy),
  locate anchor for a key, walk from head.

## CLI commands (`cli-yargs/commands/<name>/index.ts`, existing conventions)
- `account-init-list`, `account-register`, `account-top-up`,
  `account-withdraw`, `account-deregister`, `registration-update`,
  `registration-delete`.
- `batcher-init`, `batcher-load-epoch`, `batcher-pay-batch`
  (`--start`, `--count`, `--digest-file`), `batcher-run` (loop: release if
  matured → load if complete and next digest available → pay batches until
  complete).
- `reserve-release` (`--intervals`), `mint-staging-state` extended with the
  pool hash.
- CIP-20 metadata labels `midnight-reserve:<type>` for every new tx type;
  add rows to `spec/transaction-identification.md`.
- Every command goes through `completeTx` and `writeTransactionFile`; no
  `sign-and-submit` in tests.

## Emulator tests (`tests/rewards/*.test.ts`)
- Deploy pool triple + batcher + account via `tests/helpers/deploy.ts`
  extensions.
- Register 7 accounts, fabricate a digest, seed a bridge state UTXO with a
  synthetic `latest_mmr_root` (the bridge validator is not exercised; the
  batcher only reads the datum), load, fold from a random start, verify
  balances and skims, exit one account.
- Reserve release into the pool on the local profile with a 60 s interval.
- Mainnet snapshot test (`tests/helpers/mainnet-snapshot.ts`) proving the
  v2 logic staging path against real reserve UTXOs.

## Documentation
- Update `.claude/docs/architecture.md` tree and `SPEC.md` index with the
  new validators; add `docs/rewards/` links to `README.md`.

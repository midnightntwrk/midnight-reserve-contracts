# Phase 04 — `signer_cap` measurement

Goal: the largest committee of distinct single-seat members whose
`required`-quorum update fits one transaction (spec §11). Measure, do not
target.

## Tasks

### 1. Builder (`lib/bridge/test_fixtures.ak` or `lib/bridge/signer_cap.test.ak`)
`committee(n)`: `n` distinct keys (derive deterministically: precomputed
keys from phase 05's TS reference if signing is needed, or synthetic
33-byte keys with synthetic 64-byte signatures when only *size and
multiproof/MMR cost* are measured; signature verification cost is a
constant per signer, measured once with one real signature and added).
`update(n)`: signers = `required(n, 2, 3)`, multiproof over their leaves,
one MMR proof of realistic depth (`block_number ≈ 2^20`), full
`Transaction` with the forever input/output, threshold reference, one pool
input and output.

### 2. Measurements at N = 50, 100, 150, 200
- Tx size: serialize the redeemer `Data` to CBOR (`aiken` has no tx
  serializer; use the TS side in phase 05 or estimate: redeemer bytes +
  ~1.2 KB fixed for the rest). Prefer the real number: land this phase
  after 05 if the estimate is within 15% of `maxTxSize`.
- `aiken check` mem/cpu for the logic run, from the test report. Budget:
  `maxTxExecutionUnits` mem 14 M, cpu 10 G (mainnet, 2026-09).
- Real-signature cost: one test with a genuine `verify_ecdsa_secp256k1_signature`
  call, multiplied by signers.

### 3. Record
Fill spec §11 table; state the largest passing N as `signer_cap`
(candidate value for the node's `update_d_parameter` bound). Record
`max_fee` inputs: fee of the update at N = 1 signer (`base`) and the slope
per added signer (`per_signer`), from the Cardano fee formula
(`minFeeA × size + minFeeB + price × units`).

## Acceptance
- Spec §11 filled; `docs/bridge/overview.md` open-items row for
  `signer_cap` updated with the number.
- Commit: `bridge: measure signer_cap and max_fee`.

# Phase 02 — Threshold datum and `max_fee`

Goal: the threshold UTxO carries the fee cap (spec §6). Governance edits it
under the existing `threshold_validation` gate; the light client reads it
by reference.

## Tasks

### 1. `validators/thresholds.ak` (only `beefy_validation` and `beefy_signer_threshold`)
```aiken
fn beefy_validation(datum: Data) {
  expect BeefyThreshold { numerator, denominator, base, per_signer }: BeefyThreshold = datum
  and {
    numerator > -1,
    numerator < denominator,
    base > -1,
    per_signer > -1,
  }
}
```
No other validator in the file changes. Confirm with `jj diff` that the
diff is confined to those lines.

### 2. Logic
`committee_bridge_logic` already decodes `BeefyThreshold`; pass the whole
record into `verify_update` (phase 01 uses `numerator`, `denominator`;
phase 03 uses `base`, `per_signer`).

### 3. Deployment config
`deployments/*/` and `tests/deploy_thresholds.test.ts`: the BEEFY threshold
datum gains two integers. Placeholder values `base = 0`, `per_signer = 0`
until phase 04 measures; the emulator test sets non-zero values to exercise
the cap.

### 4. Tests
- `beefy_signer_threshold` mint with negative `base` → fail; with
  `numerator = denominator` → fail; valid `(2, 3, 500_000, 20_000)` → ok.
- Spend under Council + Tech Auth to a new cap → ok; to a negative cap → fail.
- An update cannot change the threshold: no test needed (no path); note in
  spec §10 stays.

## Acceptance
- `beefy_signer_threshold` hash changes in `plutus.json`; all other
  threshold validator hashes identical to before (assert by diffing
  `plutus.json` against `@-`).
- Commit: `bridge: fee cap in the BEEFY threshold datum`.

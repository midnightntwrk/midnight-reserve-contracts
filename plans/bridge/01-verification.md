# Phase 01 — Verification rules

Goal: `committee_bridge_logic` enforces MIP rules 0–10 exactly (spec §5),
with `required` quorum, signatures zipped with multiproof leaves, index-and-
count MMR verification, and exact handover checks. Bootstrap mint checks
tightened. Test fixtures in Aiken.

## Tasks

### 1. `lib/bridge/merkle.ak`
- `verify_multiproof(root, proof: Data) -> List<Leaf>`: today's walker,
  renamed; leaves in tree order.
- `verify_mmr_leaf(root, leaf_hash, leaf_index, leaf_count, items: List<ByteArray>) -> Bool`:
  port `lib/rewards/mmr.ak` `verify_leaf` from `block-rewards-validators`
  (index walk: peaks from the bits of `leaf_count`, siblings from the bits
  of the offset inside the peak, right peaks bagged as one item, left peaks
  one each; every item consumed). Delete the old right fold.
- Drop the two inline `mmr_basic_proof_*` tests or convert them to the new
  signature with `leaf_index = 552 / 600`, `leaf_count = 553 / 601`.

### 2. `lib/bridge/beefy.ak`
```aiken
pub fn required(seat_count: Int, numerator: Int, denominator: Int) -> Int
pub fn verify_update(state: BeefyConsensusState, update: BridgeUpdate, threshold: BeefyThreshold) -> BeefyConsensusState
```
`verify_update`, in rule order:
1. `expect update.block_number > state.latest_height`
2. select `S` by `validator_set_id`, else fail
3. `leaves = verify_multiproof(S.keyset_commitment, update.multiproof)`
4. keys strictly increasing: one pass, `expect bytearray.compare(prev, key) == Less`
5. `sum_signed_seats(leaves, signatures, msg_hash)`: recurse both lists
   together; `[] , []` → 0; length mismatch → fail;
   `verify_ecdsa_secp256k1_signature(slice(leaf,0,33), msg_hash, sig)`;
   seats = `bytearray_to_integer(False, slice(leaf,33,4))`
   (`msg_hash = keccak_256(scale_encode_commitment(...))`).
6. `expect seats >= required(S.seat_count, numerator, denominator)`
7. `expect update.leaf.parent_number == update.block_number - 1`
8. `expect verify_mmr_leaf(update.mmr_root, keccak_256(scale_encode_beefy_mmr_leaf(update.leaf)), update.block_number - 1, update.block_number, update.mmr_proof)`
9./10. `l = update.leaf.next_authority_set.validator_set_id`;
   `n = state.next_committee.validator_set_id`;
   `expect l == n || l == n + 1`;
   `expect !(update.validator_set_id == n && l != n + 1)`
Return the next state (handover iff `l == n + 1`).
Delete `check_auth_sigs_and_sum_seats`, `find_auth_in_leaves`,
`verify_consensus` (fold into the validator).

### 3. `validators/committee_bridge.ak`
- Logic withdraw: `state_in` via `get_input_state_by_policy`, `state_out`
  via `get_output_state_by_policy` (value = ADA + NFT enforced there), plus
  rule 0 ADA: find the forever input and output once and `expect
  lovelace_of(out) >= lovelace_of(in)`. `expect state_out == verify_update(...)`.
- Forever mint init: `next.validator_set_id == current.validator_set_id + 1`,
  `latest_height == beefy_activation_block - 1`, both roots 32 bytes.

### 4. `lib/bridge/test_fixtures.ak` (test-only, not imported by validators)
- Deterministic keys: N secp256k1 keypairs from fixed scalars (the
  `aiken/crypto` stdlib has no keygen; embed 8 precomputed pairs, generated
  once by the phase 05 TS code or by hand, in a `const`).
- `commitment(keys_with_seats) -> (root, leaves)`; `multiproof(leaves, signer_indices) -> Data`
  builder for the five-shape tree; `mmr(leaf_hashes) -> (root, fn proof(i))`
  (bag right peaks as `mmr-lib` does); `sign(key, hash) -> 64 bytes`.
  Signing needs the private key: keep the 8 fixed keys and precomputed
  signatures for the fixed commitments, or generate vectors in phase 05 and
  embed. Decide at start: if fewer than ~40 signatures are needed, embed.
- `state(...)`, `update(...)`, `tx(...)` helpers building the `Transaction`
  for the withdraw purpose (mirror `lib/rewards/test_fixtures.ak`).

### 5. Tests (`lib/bridge/beefy.test.ak`, `committee_bridge.test.ak`)
- One `fail` test per rule 0–10 (rule 0 twice: missing NFT, ADA decreased).
- Boundary accept: `block_number = latest_height + 1`, seats exactly
  `required`, leaf naming `n` by `current`.
- MIP quorum table via `required`: (10→7,6), (6→5,4), (3→3,2), (1→1).
- MIP handover table: `4/5`: leaf 5 by 4 ok no handover; leaf 6 by 5 ok
  handover; leaf 5 by 5 fail; leaf 7 fail.
- Non-signer leaf in multiproof → length mismatch fail. Signatures swapped
  → fail. High-S signature → fail (builtin).
- MMR edges: `block_number = 1` (root = leaf hash, no items); leaf that is a
  peak; three-peak item order `[siblings…, P3, P1]`.
- Bootstrap mint: `next ≠ current + 1` fail; `latest_height ≠ activation − 1` fail.

## Acceptance
- All tests green; `plutus.json` updated; spec §5 table matches the code
  (edit the "Where" column to real function names).
- Commit: `bridge: MIP rules 0-10, required quorum, signatures in tree order`.

# Phase 00 — Types and codec

Goal: `lib/bridge/types.ak` and `lib/bridge/codec.ak` carry exactly the MIP
`Data` layouts and byte encodings (spec §3, §4). Nothing else compiles yet
against them; `beefy.ak`, `merkle.ak` and `committee_bridge.ak` are
adjusted only as far as the build needs (phase 01 rewrites them).

## Tasks

### 1. `lib/bridge/types.ak`
- `AuthoritySetCommitment { validator_set_id, seat_count, keyset_commitment }`
  (rename of `id`, `len`; same `Data`).
- `BeefyMmrLeaf`, `BeefyConsensusState`: unchanged shape.
- `BeefyThreshold { numerator, denominator, base, per_signer }` (phase 02
  fills in the validation; the type lands here so 01 and 02 share it).
- New `BridgeUpdate` with the seven MIP fields in order (spec §3).
- Delete `Vote`, `Payload`, `SignedCommitment`, `RelayChainProof`,
  `BeefyConsensusProof`, `Peak`, `mmr_root_payload_id`. Keep `Leaf`,
  `ProofNodeRec`.
- Docstrings: one line each. Drop the multi-paragraph rationales.

### 2. `lib/bridge/codec.ak`
- `scale_encode_commitment(mmr_root, block_number, validator_set_id) -> ByteArray`:
  fixed 48 bytes `04 6d68 80 ‖ root ‖ u32 LE ‖ u64 LE`; `expect length(root) == 32`.
  Remove the payload-list fold and `scale_encode_length` / `scale_encode_bytes`
  unless still used.
- `scale_encode_beefy_mmr_leaf`: `seat_count` as `u32 LE` (already 4 bytes;
  confirm), `expect extra == ""` and emit `00`; keep both 32-byte guards
  and the malleability tests.

### 3. Tests (in `codec.ak`, `types.ak` needs none)
- MIP §Test vectors *Signed bytes*: `root = 00…00`, `block_number = 1`,
  `validator_set_id = 0` → `04 6d68 80 00…00 01000000 0000000000000000`.
- Existing vector `scale_encode_commitment_1` re-expressed with the new
  signature (same 48 bytes).
- MIP *Leaf*: version 0, `parent_number = 600`, given hash, commitment
  `(id, 4, root)` → `00 58020000 …` 82 bytes.
- Existing `scale_encode_beefy_leaf_1` and the two `fail` tests stay.

### 4. Build glue
`beefy.ak` / `committee_bridge.ak` must still compile: replace removed
types with `BridgeUpdate` fields at the call sites, minimal edits, no logic
change. `aiken check` green.

## Acceptance
- `just fmt && just build && just check && bun test` green.
- `plutus.json` hashes for `committee_bridge_logic` change (expected);
  `committee_bridge_forever` / two-stage unchanged.
- Commit: `bridge: MIP types and codec (u32 seats, 48-byte commitment, flat update)`.

# Phase 05 — TypeScript reference implementation and MIP vectors

Goal: an independent TS implementation of every encoding and proof the
contract verifies, producing the MIP §Test vectors as JSON, mirrored by the
Aiken fixtures, and round-tripped through the Aiken code in the Blaze VM.

## Tasks

### 1. Dependencies
`bun add -d @noble/curves @noble/hashes`. No other additions.

### 2. `tests/bridge/reference/`
- `scale.ts`: `u32le`, `u64le`, `encodeCommitment(root, blockNumber, setId)` (48 B),
  `encodeLeaf(leaf)` (82 B), `authorityLeaf(key, seats)` (37 B).
- `keccak.ts`: `keccak_256` re-export; `merkleRoot(leaves)` per MIP
  (`binary_merkle_tree::merkle_root`, unpaired last node promoted).
- `multiproof.ts`: build the five-shape `Data` tree for a set of leaf
  indices; `toPlutusData`. Property: `hash(tree) == merkleRoot(leaves)`.
- `mmr.ts`: append-only MMR with Keccak merge; `root()`, `proof(leafIndex)`
  returning `LeafProof.items` as `pallet-mmr` does (siblings, bagged right
  peaks, left peaks). Cross-check against the two golden vectors in today's
  `merkle.ak` tests (553 / 601).
- `commitment.ts`: `committeeCommitment(keysWithSeats)` → dedup, sort,
  `seat_count`, root. `required(seatCount, n, d)`.
- `sign.ts`: secp256k1 low-S signing of a 32-byte hash → 64 bytes; keys
  from fixed scalars.
- `update.ts`: build a full `BridgeUpdate` as Plutus `Data` (Blaze `Data`
  types generated from `plutus.json` by `@blaze-cardano/blueprint`).

### 3. Vectors → `tests/vectors/bridge/`
One JSON per MIP §Test vectors entry: `commitment.json` (seats `(1,2,1)`,
and `[k2,k1,k2,k3]` same root), `signed-bytes.json`, `leaf.json`,
`quorum.json`, `height.json`, `mmr-three-peaks.json`, `mmr-edges.json`,
`bootstrap.json`, `handover.json`. Plus `keys.json` (the fixed keypairs)
and `signatures.json` for the Aiken fixtures.

### 4. Aiken fixtures
Embed the JSON values as `const`s in `lib/bridge/test_fixtures.ak` (a
small script `tests/bridge/emit-fixtures.ts` prints the Aiken `const`
block; commit the output). Aiken tests assert the same bytes.

### 5. VM round trip (`tests/bridge/reference.test.ts`)
Build an update with the TS code for a 4-key committee, run
`committee_bridge_logic` via `@blaze-cardano/vm` against a hand-built
script context; expect success. Flip one byte in a signature; expect
failure.

### 6. MIP
Hand the concrete bytes to the MIP PR (`Test vectors` section); note the
JSON path in the PR.

## Acceptance
- `bun test` green including the VM test; vectors committed.
- Commit: `test(bridge): TypeScript reference implementation and MIP vectors`.

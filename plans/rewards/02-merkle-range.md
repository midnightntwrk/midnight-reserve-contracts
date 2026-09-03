# Phase 02 — Sorted multiproof with contiguity

Goal: `lib/rewards/merkle_range.ak` per spec §6, plus an Aiken-side tree
and proof builder for tests (no TypeScript yet).

## Tasks

### 1. Verifier
Copy the DFS structure of `lib/bridge/merkle.do_verify_merkle_multi_proof_get_leaves`
(do not modify the bridge file) into `merkle_range.ak`, swapping keccak for
`rewards/hash.{leaf_hash, node_hash}` and adding the contiguity state:

```aiken
pub type Reveal { Before  Inside  After }
pub fn verify_range(root: ByteArray, proof: ProofNodeRec) -> List<ByteArray>
```
Fold returns `(hash, leaves, state)`. Transitions on terminal items in DFS
(left-to-right) order: leaf: `Before→Inside`, `Inside→Inside`,
`After→fail`; hash: `Before→Before`, `Inside→After`, `After→After`.
Because the existing DFS recurses right branch first and conses leaves,
implement the state on the *left-to-right* sequence explicitly (either
reverse the recursion order or run the state machine over the collected
terminal list afterwards; the second is simpler and cheap).

Post-checks: `hash == root`; ≥ 1 leaf; keys (`bytes 1..29`) strictly
ascending.

Parsing helper:
```aiken
pub type RewardLeaf { ack: Int, key: ByteArray, amount: Int }
pub fn parse_leaf(leaf: ByteArray) -> RewardLeaf   // length >= 29; amount = big-endian of bytes 29..
```

### 2. Test-side builder `lib/rewards/merkle_range_builder.ak`
Test-only module (not imported by validators):
- `build_root(leaves: List<ByteArray>) -> ByteArray` with the promotion rule
  (odd trailing node carried up unchanged).
- `build_proof(leaves, from_index, to_index) -> ProofNodeRec` producing the
  five-shape `List<Data>` format for a contiguous range; and
  `build_proof_indices(leaves, indices)` for arbitrary (non-contiguous)
  reveals to feed negative tests.
Cross-check `build_root` against `lib/bridge/merkle.ak`'s golden test by
temporarily substituting keccak in a test (the shape is identical).

### 3. Tests `lib/rewards/merkle_range.test.ak`
For sizes 1, 2, 3, 4, 5, 7, 8, 9, 16, 17:
- every contiguous range verifies and returns the same leaves in order;
- every non-contiguous reveal (gap of one) fails;
- wrong root fails; swapped sibling fails; single-leaf tree ok;
- leaves out of order (build tree unsorted) → verifier rejects on the
  ascending check.
Budget: report `aiken check` mem/cpu for a 32-leaf range in a 50k-leaf
tree (depth 16) — record in the test file header for phase 04 sizing.

## Done when
- Tests green; documented budget numbers.

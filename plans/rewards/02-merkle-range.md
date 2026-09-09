# Phase 02 — Sorted multiproof with contiguity — DONE (commit `1189e28`)

Delivered: `lib/rewards/merkle_range.ak`, `lib/rewards/merkle_range_builder.ak`
(test-only), `lib/rewards/merkle_range.test.ak` (34 tests). Spec §2.3 and §6
are the authoritative description; this page records how it was built and
what phase 04 must honour.

## As built

### `lib/rewards/merkle_range.ak`
```aiken
pub type Reveal { Before  Inside(ByteArray)  After }
pub type RewardLeaf { ack: Int, key: ByteArray, amount: Int }
pub fn verify_range(root: ByteArray, proof: ProofNodeRec) -> List<ByteArray>
pub fn parse_leaf(leaf: ByteArray) -> RewardLeaf
```
- Same five node shapes and DFS as `lib/bridge/merkle.ak` (untouched),
  `builtin.keccak_256` inline. `ProofNodeRec` is the bridge alias
  (`List<Data>`) already used by `BatcherRedeemer`.
- The contiguity fold runs inside the DFS in its natural right-to-left visit
  order: `hash* leaf+ hash*` is its own reverse, so no second pass and no
  reversed recursion. `Inside` carries the key of the leftmost leaf seen so
  far; each new leaf must be strictly below it, which is the ascending-key
  check in the same fold.
- Terminal length checks: leaf items 45 bytes, hash items 32. A 32-byte hash
  in a leaf position or a 45-byte leaf in a hash position is rejected before
  the root comparison.
- Post-checks: `hash == root`; state not `Before` (≥ 1 leaf).
- `parse_leaf` trusts the 45-byte length `verify_range` established; it does
  not re-check.

### `lib/rewards/merkle_range_builder.ak` (test-only)
```aiken
pub fn build_root(leaves: List<ByteArray>) -> ByteArray
pub fn build_proof(leaves, from: Int, to: Int) -> ProofNodeRec       // inclusive
pub fn build_proof_indices(leaves, indices: List<Int>) -> ProofNodeRec
```
Promotion rule: trailing odd node carried up unchanged. Encoding rule: a
revealed leaf is raw bytes only next to another revealed leaf; next to a
hash or a list it is wrapped as `[leaf]`. A fully hidden subtree collapses
to its hash; a proof revealing nothing fails.

The plan's "golden test in `lib/bridge/merkle.ak`" does not exist (the
bridge only has MMR peak vectors), so `build_root` is cross-checked by
round trip through `verify_range` for every contiguous range of every size.

### Tests (`lib/rewards/merkle_range.test.ak`, 34)
Every contiguous range for sizes 1, 2, 3, 4, 5, 7, 8, 9, 16, 17 returns
the expected slice; index-set proofs equal range proofs; single-leaf tree;
`parse_leaf` fields and u128 max. Negatives (`fail` tests): 16 gap-of-one
cases across the sizes, two separated blocks, wrong root, swapped
siblings, swapped leaves, unsorted tree, duplicate key, short leaf, leaf
in hash position, hash in leaf position, empty proof.

Negative cases are enumerated, not exhaustive: Aiken cannot catch a
failure inside a loop, and the fuzz library is not a dependency.

Run with `aiken check -m 'rewards/merkle_range.{..}'` on a TTY.

### Budget (32 revealed leaves at depth 16, 2026-09-09)
| Test | mem | cpu |
|---|---|---|
| build + verify | 3.18 M | 1.64 B |
| build only | 2.44 M | 1.23 B |
| `verify_range` alone | 0.74 M | 0.41 B |

About 5% of the 14 M mem / 10 B cpu tx limits per 32-leaf range.

## Contract with phase 04 (batcher side)
- Call `verify_range(digest.root, proof)` then `parse_leaf` per returned
  leaf; leaves arrive left-to-right and strictly ascending by key.
- Contiguity says nothing about the tree's ends: check the first key against
  the cursor / `min_key` and the last against `max_key` in the batcher.
- Proof for a batch: reveal the batch's leaf indices with `build_proof`
  (inclusive range) against a tree from `build_root` of the sorted leaves.

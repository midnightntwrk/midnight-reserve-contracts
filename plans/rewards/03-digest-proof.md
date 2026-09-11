# Phase 03 — Digest proof from the bridge — DONE (commit `60ae6d1`)

Delivered: `lib/rewards/scale.ak`, `lib/rewards/mmr.ak`,
`lib/rewards/digest.ak`, `lib/rewards/mmr.test.ak`,
`lib/rewards/digest.test.ak` (43 tests). Spec §7 and §7.1 are the
authoritative description; this page records how it was built and what
phase 04 and the bridge swap must honour.

## As built

### `lib/rewards/scale.ak`
```aiken
pub fn compact(bytes: ByteArray, at: Int, callback: fn(Int, Int) -> r) -> r  // (value, next_offset)
pub fn le(bytes: ByteArray, at: Int, len: Int) -> Int                        // little-endian
```
`bridge/codec.ak` has only a private compact *encoder*, so the tests use
known SCALE bytes (0, 1, 63, 64, 16383, 16384, 2^30−1, 2^30, 2^32, 2^40)
instead of an encode/decode round trip.

### `lib/rewards/mmr.ak`
```aiken
pub fn verify_leaf(root, leaf_hash, leaf_index: Int, leaf_count: Int, items: List<ByteArray>) -> Bool
pub fn leaf_root(leaf_hash, leaf_index, leaf_count, items) -> ByteArray
```
Matches `polkadot-ckb-merkle-mountain-range` 0.8.2 (the crate polkadot-sdk
pins) for a single leaf, verified against its source:
- items = one hash per peak left of the leaf's peak, climb siblings
  bottom-up, then **one** item for all peaks to the right (the prover bags
  them when there are two or more; a single right peak is its plain hash);
- climb merges `H(left || right)`; peaks bag right-to-left as
  `H(acc || next_left)`;
- every item must be consumed; `leaf_index` must be in `0..leaf_count`.

The walk is by leaf index, not node position: the binary digits of
`leaf_count` give the peaks by descending height, and the bits of the
leaf's offset inside its peak give left/right per level. The plan's
positional form (`mmr_size`, `leaf_pos`, `pos_height`, `peaks`) was
implemented too and compared; it lives in `mmr.test.ak` as the reference
oracle. `mmr_size` validity is moot: `DigestProof` carries `leaf_count`,
and `2n − popcount(n)` is always a valid size.

Both forms agree on every leaf of every size 1..24 (builder proofs), on
the two bridge golden vectors (553 and 601, odd, lone-peak leaf), and on
six large synthetic trees. Cost on synthetic items (each test includes
~20 keccaks of item construction):

| leaf / count | items | positional | index walk |
|---|---|---|---|
| 552 / 553 | 3 | 278 K / 107 M | 224 K / 87 M |
| 12345 / 50000 | 16 | 3.37 M / 1.19 B | 313 K / 194 M |
| 49999 / 50000 | 9 | 1.85 M / 655 M | 473 K / 200 M |
| 700000 / 1000000 | 20 | 8.76 M / 2.98 B | 427 K / 253 M |
| 3 / 5000000 | 23 | 2.89 M / 1.07 B | 439 K / 275 M |

Positional recurses through `pos_height` per climb step; at one million
leaves it costs 63% of the tx memory limit. The index walk is flat.

### `lib/rewards/digest.ak`
```aiken
pub fn header_hash(header: ByteArray) -> ByteArray                       // blake2b_256
pub fn header_number(header: ByteArray) -> Int                           // Compact at 32
pub fn header_extrinsics_root(header: ByteArray) -> ByteArray            // 32 bytes after state_root
pub fn parse_rewards_call(extrinsic: ByteArray) -> Digest
pub fn verify_digest(mmr_root: ByteArray, proof: DigestProof) -> Digest
```
- Revised 2026-09-11 (phase 04 review): the digest is a **transaction in a
  Midnight block**, not a header log. `verify_digest`: MMR proof,
  `header_hash == leaf.parent_hash`, `header_number == leaf.parent_number`,
  `trie.verify(extrinsics_root, Compact(extrinsic_index), trie_nodes, extrinsic)`,
  then `parse_rewards_call`.
- `parse_rewards_call` is the only place that knows the call: 109 bytes,
  `Compact(107)`, preamble `0x04 | 0x05`, `config.rewards_pallet_index`,
  `config.rewards_call_index`, then `epoch u64 LE | leaf_count u64 LE |
  root 32 | min 28 | max 28`.
- `lib/rewards/trie.ak`: `verify(root, key, nodes, value)` walks the
  `sp_trie::LayoutV1` node path (header kinds, odd partials, `u16` bitmap,
  inline vs hashed children, inline vs hashed values). `trie_builder.ak`
  (test-only) rebuilds the trie and proofs; both reproduce the `sp_trie`
  golden vectors in `trie.test.ak` (1, 3, 5, 17, 70 extrinsics; generated
  by a small Rust tool against polkadot-sdk `660acef`).

### Tests (43 at phase 03; digest tests rewritten 2026-09-11)
`scale.ak` (5, inline), `mmr.test.ak` (18): reference helpers, every leaf
of sizes 1..24 against builder and reference, single leaf, golden 553 and
601, wrong index (same shape → `False`; different shape → abort), wrong
hash, extra/missing item, out-of-range and negative index, large-tree
agreement, three budgets. `digest.test.ak` (20): number small/large,
`extrinsics_root` after every number width, call ok / legacy preamble /
signed preamble / wrong pallet / wrong call / trailing byte / short body /
other extrinsic, end-to-end ok, empty epoch, wrong root, mutated header,
other position, parent number mismatch, other extrinsic index, index
without matching proof, tampered extrinsic, foreign trie nodes, no trie
nodes. `trie.test.ak` (16): golden vectors, builder roots and proofs,
every index of the 70-extrinsic trie, and seven failure shapes.

No real header vector exists in the repo or upstream docs; the header
tests are synthetic per the layout confirmed in
`midnight-node/runtime/src/lib.rs`. A real header + `mmr_generateProof`
vector from the node team (brief open questions) should be added to
`digest.test.ak` when it arrives.

## Contract with phase 04 and the bridge swap
- `verify_digest(latest_mmr_root, proof)` returns the `Digest`; the batcher
  checks `epoch == previous + 1` and treats `leaf_count == 0` as complete.
- The bridge fix landed in `6b5bf68a0b89` and stays inside the bridge:
  `merkle.verify_mmr_leaf` takes `leaf_count = block_number` and folds the
  last `trailing_zeros(leaf_count)` items sibling-first before bagging the
  peaks; `beefy.verify_latest_leaf` binds `parent_number + 1 ==
  block_number`. It does not import `rewards/mmr`; `mmr.test.ak`
  `golden_553`/`golden_601` show both verifiers agree on the odd case, and
  `latest_leaf.test.ak` covers the even cases. `committee_bridge_logic`
  has a new hash; the bridge needs re-audit and redeploy. An even-count
  vector from the node team goes into `bridge/latest_leaf.test.ak` when it
  arrives.

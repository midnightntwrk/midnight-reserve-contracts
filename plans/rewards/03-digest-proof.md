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
pub fn header_digest_log(header, log_index: Int, callback: fn(Int, ByteArray, ByteArray) -> r) -> r
pub fn parse_rewards_digest(engine: ByteArray, payload: ByteArray) -> Digest
pub fn verify_digest(mmr_root: ByteArray, proof: DigestProof) -> Digest
```
- Log walk skips by tag (`0` compact+len; `4/5/6` engine(4)+compact+len;
  `8` nothing; any other tag fails, also while skipping). `log_index` must
  be in `0..n_logs`.
- `parse_rewards_digest` is the only place that knows the payload:
  `engine == config.rewards_digest_engine_id` (`"MNRW"`), exactly 105
  bytes, variant byte `1`, fixed offsets 1/9/17/49/77.
- `verify_digest`: MMR proof, `header_hash == leaf.parent_hash`,
  `header_number == leaf.parent_number`, log tag `4`, then parse. Budget
  2.23 M mem / 0.69 B cpu for the synthetic end-to-end case.

### Tests (43)
`scale.ak` (5, inline), `mmr.test.ak` (18): reference helpers, every leaf
of sizes 1..24 against builder and reference, single leaf, golden 553 and
601, wrong index (same shape → `False`; different shape → abort), wrong
hash, extra/missing item, out-of-range and negative index, large-tree
agreement, three budgets. `digest.test.ak` (20): number small/large, five
log kinds by index, log after a 200-byte `Other`, index out of range and
negative, unknown tag (read and while skipping), hash, payload ok / empty
epoch / wrong engine / 104 / 106 bytes / variant 0, end-to-end ok, wrong
root, mutated header byte, wrong `log_index`, other position, parent
number mismatch.

No real header vector exists in the repo or upstream docs; the header
tests are synthetic per the layout confirmed in
`midnight-node/runtime/src/lib.rs`. A real header + `mmr_generateProof`
vector from the node team (brief open questions) should be added to
`digest.test.ak` when it arrives.

## Contract with phase 04 and the bridge swap
- `verify_digest(latest_mmr_root, proof)` returns the `Digest`; the batcher
  checks `epoch == previous + 1` and treats `leaf_count == 0` as complete.
- The bridge swap (separate reviewed change): replace
  `merkle.calculate_mmr_root` with `mmr.verify_leaf` using
  `leaf_index = parent_number`, `leaf_count = parent_number + 1`, and bind
  `leaf.parent_number + 1 == commitment.block_number`. Item order from
  `mmr_generateProof` is exactly what `leaf_root` consumes.

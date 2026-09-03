# Phase 03 — Digest proof from the bridge

Goal: `lib/rewards/digest.ak` implementing spec §7 and §7.1:
`verify_digest(mmr_root, proof) -> Digest`.

## Tasks

### 1. SCALE compact decoder `lib/rewards/scale.ak`
```aiken
pub fn compact(bytes: ByteArray, at: Int) -> (Int, Int)   // (value, next_offset)
```
Modes `00/01/10/11` per spec §7.1. Tests: 0, 1, 63, 64, 16383, 16384,
2^30−1, 2^30, 2^32, 2^40 against known SCALE bytes.

Check `lib/bridge/codec.ak` first: if a compact *encoder* exists, add tests
that decode(encode(x)) == x.

### 2. Header parser
```aiken
pub fn header_hash(header: ByteArray) -> ByteArray                 // blake2b_256
pub fn header_digest_log(header: ByteArray, log_index: Int) -> (Int /*tag*/, ByteArray /*engine or ""*/, ByteArray /*payload*/)
```
Walk: 32 + compact + 64 + compact(n) then `log_index` items skipping by tag
(0: compact+len; 4/5/6: 4 + compact + len; 8: nothing; other tag → fail).
Tests: the `sp_runtime` header test vector from spec §7.1 (single `Other`
log); a synthetic header with `[PreRuntime, Consensus, Seal]` logs;
`log_index` out of range fails.

### 3. Digest extraction
```aiken
pub fn parse_rewards_digest(engine: ByteArray, payload: ByteArray) -> Digest
```
`engine == config.rewards_digest_engine_id`; payload
`u64 LE epoch || 32-byte root || Vec<u8> min || Vec<u8> max`. Engine id
`MNRW` and carrier (first block of `E + 1`, `Consensus` item) are decided;
the payload layout is our proposal until the node team confirms. Keep this
function the only place that knows the layout.

### 4. Positional MMR verifier `lib/rewards/mmr.ak`
```aiken
pub fn mmr_size(leaf_count: Int) -> Int
pub fn leaf_pos(index: Int) -> Int
pub fn pos_height(pos: Int) -> Int
pub fn peaks(mmr_size: Int) -> List<Int>
pub fn verify_leaf(root: ByteArray, leaf_hash: ByteArray, leaf_index: Int, leaf_count: Int, items: List<ByteArray>) -> Bool
```
Algorithm per spec §7.1 (climb with left/right by `pos_height(pos + 1) > h`,
then bag right-to-left with `H(acc || left_peak)`), keccak-256 throughout.
Validate `leaf_index < leaf_count` and that `mmr_size` is a valid MMR size
(peak decomposition round-trips).

Regression: for `leaf_index == leaf_count − 1` with odd `leaf_count` the
result must equal `bridge/merkle.calculate_mmr_root` on the same items
(import the bridge module in tests only; both golden vectors are odd: 553
and 601). The bridge function stays as is (decided; mandatory BEEFY
commitments land on odd blocks). Add one even-count test here so the
positional verifier is proven on the case the bridge never exercises, and
note the result for the bridge re-audit. Do not edit bridge files.

Vectors: derive a small MMR (leaf_count 1..8) by hand in the test module
with a builder `build_mmr(leaves) -> (root, fn(index) -> items)`; plus the
two golden vectors already in `lib/bridge/merkle.ak`.

### 5. `verify_digest`
```aiken
pub fn verify_digest(mmr_root: ByteArray, proof: DigestProof) -> Digest
```
1. `leaf_hash = keccak256(scale_encode_beefy_mmr_leaf(proof.leaf))`
   (`bridge/codec`).
2. `verify_leaf(mmr_root, leaf_hash, proof.leaf_index, proof.leaf_count, proof.items)`.
3. `header_hash(proof.header) == proof.leaf.parent_hash`; also
   `proof.leaf.parent_number` equals the header's `number` (parse it, cheap).
4. `(tag, engine, payload) = header_digest_log(proof.header, proof.log_index)`;
   `tag == 4` (Consensus); `parse_rewards_digest(engine, payload)`.

Tests: end-to-end synthetic (builder MMR + synthetic header + digest);
mutated header byte fails; wrong `log_index` fails; leaf from another
position fails.

## Done when
- Tests green; budget for `verify_digest` recorded (it runs once per epoch,
  so cost is not critical, but must fit one tx with a batch).
- Node-team questions listed in `00-index.md` sent: hasher, engine id,
  payload layout, which block carries the digest.

# Block Rewards — Brief for the midnight-node team

Status: Draft, 2026-09-03. Companion to [spec.md](spec.md) (Cardano
contracts). This page lists exactly what the rewards pallet must emit so the
Cardano verifier can consume it, plus the questions we need answered back.
Facts about the node below were read from `midnight-node` at the current
checkout; correct us if any moved.

## 1. Facts we rely on

| Fact | Source |
|---|---|
| `BlockNumber = u32`, header = `generic::Header<u32, BlakeTwo256>` | `runtime/src/lib.rs:142,175,1233` |
| MMR `Hashing = Keccak256`, `LeafVersion (0,0)`, `LeafExtra = Vec<u8>` empty | `runtime/src/lib.rs:501-552` |
| Leaf `i` of the MMR holds `parent_number_and_hash` of block `i + 1`'s parent | pallet-mmr `on_initialize` |
| Existing Midnight consensus engine id `MNSV` (version pallet) | `pallets/version/src/lib.rs:30` |
| Epoch = `Sidechain::slots_per_epoch()` slots (genesis 300 × 6 s) | `runtime/src/lib.rs:441-447`, `node/src/chain_spec/mod.rs:287` |
| NIGHT amounts are `u128` STARs; cNIGHT on Cardano is the same unit (6 decimals) | `ledger/src/host_api/ledger_9.rs:404` |
| BEEFY `min_block_delta = 8`; sessions end at the first block of a PC epoch only when the next committee is defined | `node/src/service.rs:1175`, `partner-chains/.../pallet_session_support.rs:121-139` |

## 2. Reward leaf (45 bytes, fixed)

```
leaf = ack(1) || stake_key_hash(28) || amount(16, u128 big-endian)
```
- `ack`: `0x00` normal; `0x01` = acknowledgement of an observed
  `committed = Some(addr)` on the deposit UTXO. Emit `0x01` exactly once per
  account and drop the account from later digests. The amount on an ack leaf
  includes any pending balance.
- `stake_key_hash`: the 28-byte hash of the Cardano stake credential (key or
  script hash; the kind is not encoded). This is the deposit UTXO's key.
- `amount`: cNIGHT token units to add to the deposit. May be 0 on an ack
  leaf.
- One leaf per funded account; leaves **sorted ascending by the 28 key
  bytes** (plain bytewise compare), unique keys.

## 3. Reward tree

- `leaf_hash = keccak256(leaf)`; `node = keccak256(left || right)`.
- Pairs merged left to right per level; a trailing odd node is **promoted
  unchanged** (no duplication, no padding). This is
  `binary_merkle_tree::merkle_root::<Keccak256, _>(leaves)` from
  polkadot-sdk, already used in `runtime/src/beefy.rs:174`.
- `leaf_count == 0`: publish `root = [0u8; 32]`, keys all zero; the contract
  ignores root and keys when `leaf_count == 0`.
- Off-chain provers (batchers) build their own multiproofs; the pallet only
  needs to produce the root.

## 4. Digest transaction

Once per epoch the rewards pallet (`pallet_block_rewards`, replacing the
old mNIGHT-payout pallet of the same name) submits a **bare inherent** in a
Midnight block, at or after the first block of epoch `E + 1`:

```rust
#[pallet::call]
impl<T: Config> Pallet<T> {
    #[pallet::call_index(0)]
    pub fn submit_rewards_digest(
        origin: OriginFor<T>,   // ensure_none
        epoch: u64,             // partner-chains sidechain epoch E (the epoch being paid)
        leaf_count: u64,
        root: [u8; 32],
        min_key: [u8; 28],      // key of the first leaf
        max_key: [u8; 28],      // key of the last leaf
        treasury_total: u128,   // Σ Nt over the epoch's blocks, STAR; paid to the ICS by the completing batch
    ) -> DispatchResult
}
```
Produced through `ProvideInherent` like `pallet_cnight_observation`. On the
wire (`UncheckedExtrinsic::new_bare`, format v5) the extrinsic is exactly
125 bytes: `Compact(123) | 0x05 | pallet_index | 0 | epoch LE | leaf_count LE | root | min | max | treasury_total LE`.
Exactly one such extrinsic per epoch; epochs consecutive (an epoch with no
funded accounts still submits `leaf_count = 0`, zero root and keys). The
contract accepts it from any block; the block need not be the epoch
boundary.

## 5. How Cardano verifies it

1. Reads `latest_mmr_root` from the committee bridge UTXO.
2. Batcher supplies: the BEEFY MMR leaf for block `N + 1` (where `N` is the
   block holding the digest extrinsic), a positional MMR proof
   (`LeafProof { leaf_indices: [i], leaf_count, items }` from
   `mmr_generateProof`), the raw SCALE header of block `N`, the extrinsic
   index, the `extrinsics_root` trie nodes on the path (root first,
   hash-referenced ones only) and the extrinsic bytes.
3. Checks `keccak256(SCALE(leaf))` is in the root, `blake2b_256(header) == leaf.parent_hash`,
   reads `extrinsics_root` from the header, verifies the `sp_trie::LayoutV1`
   (blake2b-256, `StateVersion::V1`) inclusion of the extrinsic bytes under
   `Compact(index)`, and decodes the call (pallet index, call index 0, 120
   bytes of arguments).

So any block at or below the bridge checkpoint is provable; payouts lag at
least one bridge checkpoint behind the digest.

## 6. Registration record (what the node reads)

Inline datum of the UTXO holding `0x01 ++ skh` under the `virtual_account`
policy (`AccountDatum::Registration`, constructor index 2):

```
owner:          Credential                    (edit/delete authority; not for the node)
destinations:   Pairs<ByteArray, Int>         kind_byte ++ address -> weight
operator_keys:  Pairs<ByteArray, ByteArray>   name -> key bytes
```

- Kind bytes now: `0x00` = dust address (DUST generation target), `0x01`
  = stake / NIGHT address. No others yet; new kinds are a node-side
  decision, the contract does not interpret the byte.
- Weights: every weight `> 0`, sum over the whole list `== 1000`
  (enforced on chain). The split is across all destinations together,
  e.g. `[0x00‖A: 600, 0x01‖B: 400]` = 60 % dust at A, 40 % NIGHT at B.
- `operator_keys` names: `"beefy"`, `"babe"`, `"aura"`, `"sidechain"`,
  `"spo"`, … — opaque on chain; the node schema owns names and lengths.
  Empty list = not an operator.
- The deposit UTXO (`0x00 ++ skh`) holds the NIGHT; the registration
  holds no value besides its NFT.

## 7. Questions for the node team

1. Confirm the call layout in §4 and give us the pallet index of
   `pallet_block_rewards` in `construct_runtime!` (the contract pins
   `rewards_pallet_index` / `rewards_call_index` in its config).
2. Confirm the epoch counter: partner-chains sidechain epoch (`u64`). Which
   epoch number will the first digest carry on mainnet? (The batcher state
   is initialised with `epoch = first − 1`.)
3. Confirm `binary_merkle_tree::merkle_root::<Keccak256>` is the tree
   builder and that leaves are the raw 45 bytes (hashed once by the crate).
4. Provide one BEEFY commitment + MMR proof for an **even** block number
   from devnet. The current bridge `calculate_mmr_root` only handles a leaf
   that is a lone peak (odd `leaf_count`); sessions on Midnight have no fixed
   parity, so the bridge is expected to stall on the first even session
   start. We need the vector to confirm and to test the positional verifier.
5. `mmr_generateProof` leaf index for block `N + 1`: `N + 1 − 1 − activation_offset`?
   Confirm the offset (`beefy_activation_block` in the bridge datum is
   "reserved for off-chain consumers").
6. Confirm `system_version = 3` stays (`StateVersion::V1` for
   `extrinsics_root`) and provide one real block: header bytes, the
   extrinsic list and the digest extrinsic's index, so
   `lib/rewards/digest.test.ak` gets a non-synthetic vector.
7. Pending-balance policy for unregistered / underfunded recipients
   (retention, expiry) — pallet-side, not needed by the contract, but the
   ack leaf must include the pending amount.
8. Funded floor (~3 ADA) and the 12 h observation lag: confirm the pallet
   reads deposit UTXOs at `k + block_stability_margin` depth via `mc_hash`
   like other Cardano observations.

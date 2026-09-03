# Block Production Rewards — Contract Specification

Status: Draft. Items marked **TBD** need a decision from the node team or
tokenomics before implementation of that piece is final. Everything else is
settled. Overview: [overview.md](overview.md).

Conventions: Aiken v1.1.21, Plutus V3, stdlib v2.2.0 (repo pins; no
toolchain bump). All new Aiken code lives in new files under `lib/rewards/`
and `validators/`; audited files stay untouched. NIGHT = `config.cnight_policy`
/ `config.cnight_name`. Byte sizes are exact unless stated.

---

## 1. Components and hash dependencies

```
rewards_batcher  (fixed)      no deps on new hashes; reads bridge via config.committee_bridge_forever_hash
      ^                 ^
      |                 |
virtual_account (fixed) |     config.rewards_batcher_hash
                        |
rewards_pool_{forever,two_stage_upgrade,logic}   logic: config.rewards_batcher_hash
      ^
      |
reserve_logic_v2 (rewrite)    config.rewards_pool_forever_hash (+ StagingState for the test track)
```

Build order for `build-engine.ts`: batcher → account → pool triple → reserve
logic v2. The batcher never embeds the account or pool hash; it learns them
from its own state datum at init (§5.1). This breaks the batcher⇄account and
batcher⇄pool cycles.

Validators:

| File | Validator | Purposes |
|---|---|---|
| `validators/virtual_account.ak` | `virtual_account` | mint, spend |
| `validators/rewards_batcher.ak` | `rewards_batcher` | mint (state NFT), spend (state UTXO), withdraw (batch logic), publish |
| `validators/rewards_pool.ak` | `rewards_pool_forever`, `rewards_pool_two_stage_upgrade`, `rewards_pool_logic` | forever pattern |
| `validators/staging_rewards_pool.ak` | `rewards_pool_staging_forever` | staging track |
| `validators/reserve_v2.ak` | `reserve_logic_v2` (rewritten; the current file was a test stub, never promoted) | withdraw, mint (StagingState), publish |

Libraries:

| File | Content |
|---|---|
| `lib/rewards/types.ak` | every datum / redeemer below |
| `lib/rewards/linked_list.ak` | head/insert/unlink primitives (hand-ported, §4.2) |
| `lib/rewards/account.ak` | virtual account mint + spend logic |
| `lib/rewards/merkle_range.ak` | sorted multiproof verifier with contiguity (§6) |
| `lib/rewards/digest.ak` | MMR positional proof + SCALE header parse + digest extraction (§7) |
| `lib/rewards/batch.ak` | batcher withdraw logic (§5) |
| `lib/rewards/schedule.ak` | emission math (§8) |
| `lib/rewards/release.ak` | reserve v2 release + merge (§8) |
| `lib/rewards/auth.ak` | `stake_auth(cred, extra_signatories, withdrawals)` |

---

## 2. Shared definitions

### 2.1 Stake authorization

```aiken
/// VerificationKey: hash in extra_signatories. Script: a withdrawal from that credential exists.
pub fn stake_auth(cred: Credential, extra_signatories: List<VerificationKeyHash>, withdrawals: Pairs<Credential, Int>) -> Bool
```
Same rule as `cnight_generates_dust.check_auth`. Script stake credentials
are supported in v1 for register, withdraw, top-up, deregister.

### 2.2 Keys and NFT names

`skh` = stake key hash, 28 bytes. All account NFTs are under the
`virtual_account` policy:

| Asset name | Meaning |
|---|---|
| `""` (0 bytes) | list head, one per deployment |
| `0x00 ++ skh` (29 bytes) | deposit node |
| `0x01 ++ skh` (29 bytes) | registration record |
| `0x00 ++ tail_key` (29 bytes) | list tail, one per deployment; `tail_key = 0xff × 28` |

List order = `bytearray.compare` on the 28-byte `skh`. The head sorts before
every node by construction (`Head` has no key); the tail sorts after every
node because `insert_ascending` requires `new_key < tail_key`.

### 2.3 Reward leaf

```
leaf = ack(1) ++ skh(28) ++ amount(16, u128 big-endian)      // 45 bytes, fixed
```
- `ack`: `0x00` normal, `0x01` Midnight acknowledges `Deregister`.
- `amount`: cNIGHT token units (1:1 with ledger STARs). Parsed with
  `builtin.byte_string_to_integer(True, slice)`.
- Leaves are **sorted ascending by `skh`** (bytewise), unique per `skh`.
- The contract rejects a leaf whose length is not 45.
- `leaf_hash = H(leaf)`, `node_hash = H(left ++ right)`, `H = keccak_256`
  (decided: one hash family across the whole bridge path; the pallet can
  use `binary-merkle-tree<Keccak256>`). `builtin.keccak_256` inline, no
  wrapper module.

### 2.4 Digest

Per Midnight epoch `E` (partner-chains sidechain epoch), the pallet emits
`Digest { epoch: E, leaf_count, root, min_key, max_key }` as a
`Consensus("MNRW", …)` log in the header of the **first block of epoch
`E + 1`**. `min_key`/`max_key` are the first and last leaf `skh`. Empty
epoch: `leaf_count == 0`, `root` = 32 zero bytes, keys zero; the contract
ignores `root` and keys when `leaf_count == 0`. Payload bytes in §7.1.
Full node-side contract: [node-team-brief.md](node-team-brief.md).

---

## 3. Virtual account — registration UTXO

Address: `virtual_account` script, no stake part (batcher never reads it;
users may attach their own stake credential — allowed, not required).

```aiken
AccountDatum::Registration {      // skh lives only in the NFT name
  owner: Credential,              // edit/delete authority after creation
  dust_address: ByteArray,        // <= 33 bytes; "" = none
  validator_keys: ByteArray,      // opaque blob owned by the node schema; "" = not an SPO
  spo_intent: Bool,
}
```
Value: ADA + `0x01 ++ skh` NFT, nothing else.

| Action | Redeemer | Rule |
|---|---|---|
| create | only inside `Register` (§4.3) | minted together with the deposit node; stake auth from the mint |
| update | `Spend: UpdateRegistration` | `owner` auth; NFT continues to the same address; `dust_address` ≤ 33 bytes |
| delete | `Spend: Deregister`, only inside the deposit's `SetDeregister` tx (§4.4) | `owner` auth; mint = −1 of `0x01 ++ skh`; the deposit with the same `skh` flips `committed` in the same tx |

No standalone delete: deregistration is one atomic user tx that burns the
registration and flags the deposit. Invariant: a registration NFT exists
iff a deposit with the same `skh` exists with `committed == None`. There
is no path to mint a registration NFT without inserting a deposit node, so
one registration per `skh` holds by construction. Re-registering the same
`skh` needs a fresh insert, possible only after the deposit exit (§4.5):
12 h lag plus an epoch plus the batcher ack. Midnight reads the new schema
first and falls back to `cnight_generates_dust` records forever; no
migration path on chain.

---

## 4. Virtual account — deposit UTXO and linked list

### 4.1 Datum

```aiken
pub const tail_key = #"ff…ff"     // 28 bytes

pub type AccountDatum {
  Head { next: ByteArray }        // first skh, or tail_key when the list is empty
  Deposit {
    cred: Credential,             // stake credential; key = its 28-byte hash
    next: ByteArray,              // next skh in ascending order; tail_key at the end
    committed: Option<Address>,   // None | Some(refund_addr) once Deregister is set
  }
  Registration { .. }             // §3
  Tail                            // sentinel node; no spend path
}
```
`key(d) = hash bytes of d.cred` (`VerificationKey(h) | Script(h) → h`).
The kind is only used by `stake_auth`; NFT names, ordering, leaves, and the
digest all use the 28-byte hash.
Deposit value: ADA + `0x00 ++ skh` NFT + NIGHT (≥ 0). No other assets.

### 4.2 Linked list (`lib/rewards/linked_list.ak`)

Hand-ported subset of the Anastasia Labs pattern, kept to what is used:

```aiken
pub fn init_list(inputs, mint, outputs, own_policy, one_shot_ref) -> Bool
pub fn insert_ascending(inputs, outputs, mint, own_policy, new_key) -> (Output /*anchor out*/, Output /*node out*/)
pub fn unlink(inputs, outputs, own_policy, removed_key, removed_next) -> Bool
```
Rules enforced by the **mint policy** (spend paths only check "a mint/burn
under own policy exists"):
- `init_list`: one-shot ref consumed; mint exactly
  `[("", 1), (0x00 ++ tail_key, 1)]`; two outputs at own address:
  `Head { next: tail_key }` with ADA + head NFT, `Tail` with ADA + tail NFT.
- `insert_ascending(new_key)`: exactly one list input with a `Head` or
  `Deposit` datum carrying a list NFT = anchor; `anchor.key < new_key`
  (head: always) and `new_key < anchor.next` (so `new_key < tail_key`);
  anchor output identical except `next = new_key`; new node output at own
  address with `Deposit { cred, next: anchor.next, committed: None }` where
  `key(cred) == new_key`.
- `unlink(removed_key, removed_next)`: predecessor input with
  `next == removed_key` continues with `next = removed_next`, all else
  unchanged; mint = −1 of `0x00 ++ removed_key`. The tail node is never
  unlinked (a `Tail` datum has no spend path).
- All `inputs`/`outputs` passed are the full transaction lists in ledger
  order; a caller never filters them first.

### 4.3 Register (mint redeemer `Register { cred: Credential }`)

`skh = key(cred)`. One tx, mint = `[(0x00++skh, 1), (0x01++skh, 1)]`:
1. `stake_auth(cred, …)`; the new deposit datum stores this `cred`.
2. `insert_ascending(skh)`; the new deposit output has
   `deposit_min ≤ ADA ≤ deposit_cap` and NIGHT = 0.
3. Exactly one registration output (§3) carrying the `0x01 ++ skh` NFT.
4. `own_policy != config.cnight_policy` (hash-touch idiom).

### 4.4 User spend paths on a deposit

| Redeemer | Auth | Continuing output rule |
|---|---|---|
| `Withdraw` | stake auth for `cred` | same address, same datum, same NFT, NIGHT = 0, ADA unchanged |
| `TopUp` | stake auth for `cred` | same datum/NFT/NIGHT; `ADA_out − ADA_in ≥ deposit_min`; `ADA_out ≤ deposit_cap` |
| `SetDeregister(addr)` | stake auth for `cred`; `committed == None`; the registration UTXO `0x01 ++ key` is spent with `owner` auth and its NFT burned in this tx | same value/NFT; datum `committed = Some(addr)` |
| `AnchorInsert` | none | mint of `+1` under own policy exists (mint policy validates the anchor) |
| `BatcherPay` | none | withdrawal from `config.rewards_batcher_hash` present (batch logic validates) |

`Withdraw` is total-balance only; combined with the cap on top-ups and the
once-per-lifetime flag, user-caused spends of a deposit are bounded.
Withdrawal destination is unconstrained.

### 4.5 Batcher paths on a deposit (checked inside `rewards_batcher` withdraw, §5.4)

- **Pay**: `ADA_out ≥ ADA_in − skim`; `NIGHT_out = NIGHT_in + amount`;
  datum, address, NFT unchanged. `skim ≤ min(ceil(fee / n_paid), batcher_skim_max_lovelace)`
  where `fee` is the tx fee and `n_paid` the number of leaves paid in this
  tx (exits included). Cost recovery only, no margin; the per-account cap
  stops a padded fee from draining deposits and rewards larger batches.
- **Exit** (leaf `ack = 1`): requires `committed == Some(addr)`; no
  continuing deposit output; burn `0x00++skh`; `unlink(skh, next)`; an
  output to `addr` with `ADA ≥ ADA_in − skim` and `NIGHT ≥ NIGHT_in + amount`.
  The registration is already gone (burned in the `SetDeregister` tx).

Head spend: only `AnchorInsert` and the batcher exit (unlink of the first
node, gated by the batcher withdrawal). Tail spend: always fails.

---

## 5. Rewards batcher (`rewards_batcher`, fixed)

### 5.1 State

One UTXO at the `rewards_batcher` address, NFT `("", 1)` under its own policy,
minted one-shot from `config.rewards_batcher_one_shot_{hash,index}`.

```aiken
pub type BatcherState {
  account_policy: PolicyId,       // virtual_account hash, set at init, 28 bytes
  pool_forever: ScriptHash,       // rewards_pool_forever hash, set at init, 28 bytes
  epoch: Int,                     // last loaded epoch; init = first_epoch − 1
  root: ByteArray,                // 32
  min_key: ByteArray,
  max_key: ByteArray,
  start_key: ByteArray,           // first skh paid in the current epoch
  cursor: ByteArray,              // last skh paid; both stale once complete
  complete: Bool,                 // init = True
}
```
`start_key` and `cursor` are read only while `complete == False`; an epoch
always opens through `LoadAndPay`, which overwrites both with its first
batch. Init mint validates only shapes (28-byte hashes, `complete == True`).
Deployer sets the hashes; governance owns deployment.

`wrapped` is not stored: the jump `max_key → min_key` is allowed only when
`cursor == max_key`, and after it the run can never reach `max_key`
again without crossing `start_key`, which is rejected (§5.3). So one wrap per
epoch is implied.

### 5.2 Spend / publish

- `Spending` the state UTXO: a withdrawal from own script hash exists. All
  logic runs in the withdraw branch once per tx.
- `Publishing RegisterCredential` → `True`.

### 5.3 Withdraw redeemer

```aiken
pub type BatcherRedeemer {
  Pay { proof: ProofNodeRec, pairs: List<PayPair>, exits: List<ExitInfo> }
  LoadAndPay { digest_proof: DigestProof, proof: ProofNodeRec, pairs: List<PayPair>, exits: List<ExitInfo> }   // digest: §7
}
pub type PayPair { input_index: Int, output_index: Int }       // deposit in/out per paid leaf, in leaf order
pub type ExitInfo { pred_input_index: Int, pred_output_index: Int, refund_output_index: Int }
```

There is no standalone load: an epoch opens with its first batch, so
`complete` alone distinguishes "between epochs" from "mid-run".

**LoadAndPay** (first batch of an epoch)
1. `state_in.complete == True`.
2. `digest = verify_digest(bridge_state.latest_mmr_root, digest_proof)`
   where `bridge_state` is the inline datum of the reference input holding
   the `config.committee_bridge_forever_hash` singleton NFT.
3. `digest.epoch == state_in.epoch + 1` (strict succession).
4. `loaded = state_in with { epoch, root, min_key, max_key }`.
5. `leaf_count == 0`: `proof`, `pairs`, `exits` empty; `state_out = loaded`
   (`complete` stays `True`); no pool or deposit inputs. Otherwise apply
   the batch rules below to `loaded` with no anchor: `paid = leaves`,
   `start_key := key(paid[0])`, `complete := cursor == max_key && start_key == min_key`.

**Pay** (every later batch)
1. `state_in.complete == False`.
2. Split `leaves` into `(anchor, paid, boundary)`:
   - `cursor == max_key` and `start_key != min_key`: no anchor;
     `key(leaves[0]) == min_key` (wrap).
   - otherwise: `key(leaves[0]) == cursor` and it is the anchor (already
     paid, not paid again); `paid = leaves[1..]`.
   - If the last leaf's key `== start_key` it is the boundary: not paid;
     `complete := True`.
3. Then the batch rules below.

**Batch rules** (both redeemers)
1. `leaves = verify_range(root, proof)` (§6): ascending, contiguous;
   `paid` non-empty.
2. No paid leaf has `key == start_key` (only the first batch pays it, as
   `paid[0]`).
5. Every paid leaf: find deposit input/output by `pairs[i]`; input value
   holds `0x00 ++ key` under `account_policy`; apply §4.5 Pay or Exit.
   Indices in `pairs` strictly increase (no double satisfaction).
6. Pool: all inputs at `Script(pool_forever)` are summed (none may carry the
   pool forever NFT); exactly one output to that address with
   `NIGHT_out == NIGHT_in − Σ amount`, `ADA_out ≥ ADA_in`, value shape
   `[ada, night]`, inline datum. Pool logic is satisfied separately (§9).
7. `cursor := key(last paid)`; `complete` per the redeemer's split and also
   when `cursor == max_key && start_key == min_key`.
8. `state_out` otherwise unchanged; NFT continues.

### 5.4 Costs

Per deposit input the spend script runs a constant-size gate (withdrawal
lookup). The withdraw script does one multiproof verification plus a linear
pass over paid leaves and their `pairs`. Tx size bounds the batch: about
300 bytes per deposit in/out pair plus ~64 bytes per proof node. Target
K ≈ 25–40 accounts per batch on mainnet limits; tune with `aiken check`
budgets in phase 04. The skim cap (§4.5) makes larger K the only way for a
batcher to recover a large fee, so incentives point the same way.

The reserve `Release` and an empty-epoch `LoadAndPay` are uncompensated; a
batcher recovers the digest-proof cost from the skims of the first batch.

Mid-fold contention from user withdrawals is accepted without a lock: each
account can do it once per payout and the batcher retries.

---

## 6. Sorted multiproof with contiguity (`lib/rewards/merkle_range.ak`)

Proof format: the existing DFS shape from `lib/bridge/merkle.ak`
(`ProofNodeRec = List<Data>`, five node cases), same keccak-256 hashing.
Tree construction rule (**pallet
requirement**): leaves hashed individually, pairs merged left-to-right per
level, a trailing odd node is promoted unchanged (no duplication, no
padding). This is exactly the shape the DFS verifier recomputes.

`verify_range(root, proof) -> List<Leaf>`:
1. DFS as today, returning leaves in left-to-right order.
2. Contiguity: in DFS order the terminal items must match
   `hash* leaf+ hash*`. A three-state fold (`Before | Inside | After`)
   rejects a leaf after `After` and a hash inside `Inside` moves to
   `After`. This rejects any proof whose revealed leaves are not one
   contiguous block.
3. Keys strictly ascending across the revealed leaves (cheap double check;
   also catches a malformed pallet tree).

Edges (`min_key`, `max_key`) come from the digest, so the verifier does not
need to know whether the block touches the tree's ends.

---

## 7. Digest proof from the bridge (`lib/rewards/digest.ak`)

Source of trust: `BeefyConsensusState.latest_mmr_root` (keccak MMR) on the
committee bridge forever UTXO, read as a reference input.

Chain of custody for epoch `E` whose digest is in the header of block `N`:
1. MMR leaf for block `N + 1` (`BeefyMmrLeaf`, SCALE via
   `bridge/codec.scale_encode_beefy_mmr_leaf`) carries
   `parent_number == N` and `parent_hash == blake2b_256(header_N)`.
2. Positional MMR inclusion proof of that leaf against `latest_mmr_root`.
   New code: the existing `verify_mmr_leaf` only handles the latest leaf.
3. `header_N` supplied as raw SCALE bytes; `blake2b_256(header_N) == parent_hash`.
4. Parse the header far enough to reach `digest.logs`, find the rewards
   digest item, decode `Digest { epoch, root, min_key, max_key }`.

```aiken
pub type DigestProof {
  leaf: BeefyMmrLeaf,
  leaf_index: Int,
  leaf_count: Int,
  items: List<ByteArray>,         // MMR proof items (siblings + peaks) per sp_mmr_primitives::Proof
  header: ByteArray,              // SCALE header of block N
  log_index: Int,                 // which digest log to read
}
pub fn verify_digest(mmr_root: ByteArray, proof: DigestProof) -> Digest
```

MMR verification and header layout: see §7.1 (filled from polkadot-sdk
sources).

Digest log: `DigestItem::Consensus("MNRW", payload)` in the header of the
first block of epoch `E + 1`, payload per §7.1 (`MNSV` is the existing
Midnight engine id; `MNRW` is free). Any block below the bridge checkpoint
is provable, so payouts may lag any number of epochs without losing
provability; the contract still enforces strict `E + 1` succession.

### 7.1 Encodings (from polkadot-sdk master, 2026-09-03)

**MMR proof** (`sp_mmr_primitives::LeafProof { leaf_indices, leaf_count, items }`,
lib `polkadot-ckb-merkle-mountain-range`), single leaf, all hashes keccak-256,
no domain prefixes:

```
mmr_size(leaf_count)     = 2 * leaf_count − popcount(leaf_count)
pos(index)               = mmr_size(index + 1) − trailing_zeros(index + 1) − 1
height(pos)              : strip leading all-ones blocks of (pos + 1) until all ones; height = bits − 1
sibling_offset(h)        = (2 << h) − 1
climb: while pos is not a peak of mmr_size:
   if height(pos + 1) > height(pos)   -- pos is a right child
        item = H(sibling || item); pos += 1
   else                                -- pos is a left child
        item = H(item || sibling);   pos += sibling_offset(height) + 1
   (sibling = next proof item)
peaks(mmr_size)          : left-to-right positions from the binary decomposition of mmr_size
remaining items          = hashes of the other peaks, left-to-right, our climbed hash in its slot
bag right-to-left        : acc = rightmost; acc = H(acc || next_left_peak) ...; root = acc
```
Reject `leaf_count` whose `mmr_size` is not a valid MMR size, and
`leaf_index ≥ leaf_count`. The existing `bridge/merkle.calculate_mmr_root`
is the lone-peak special case (`foldr` with `H(acc || item)`, correct only
when `leaf_count` is odd, which holds for both golden vectors: 553 and 601).
Midnight sessions have no fixed block parity (slot-based epochs, deferred
rollovers, BEEFY `min_block_delta = 8`), so the bridge is expected to stall
at the first even-numbered mandatory block. Decision: the rewards verifier
(`lib/rewards/mmr.ak`) is positional and must reproduce the bridge result
for the odd case; the bridge swaps to it, and binds
`leaf.parent_number + 1 == commitment.block_number`, in its own reviewed
change after phase 03, followed by re-audit. Rewards work does not edit
bridge files.

**BEEFY MMR leaf**: `version: u8` (major << 5 | minor), `parent_number_and_hash: (BlockNumber u32 LE, H256)`,
`beefy_next_authority_set { id: u64, len: u32, keyset_commitment: H256 }`,
`leaf_extra`. Already encoded by `bridge/codec.scale_encode_beefy_mmr_leaf`;
`leaf_hash = keccak256(SCALE(leaf))`.

**Header** (`sp_runtime::generic::Header<u32, BlakeTwo256>`, confirmed in
`midnight-node/runtime/src/lib.rs:142,175`):

```
parent_hash(32) || Compact(number) || state_root(32) || extrinsics_root(32) || Compact(n_logs) || log*
log: 0x00 Compact(len) bytes                      Other
     0x04 engine_id(4) Compact(len) bytes         Consensus
     0x05 engine_id(4) Compact(len) bytes         Seal
     0x06 engine_id(4) Compact(len) bytes         PreRuntime
     0x08                                         RuntimeEnvironmentUpdated
header_hash = blake2b_256(bytes)
```
Compact<u32/u64>: low two bits of the first byte select 1/2/4-byte LE
(`00/01/10`, value = raw >> 2) or big-int mode (`11`, byte count =
(first >> 2) + 4, LE). The parser needs only: skip 32, compact, skip 64,
compact count, then walk logs skipping by tag until `log_index`.

Rewards digest log: `Consensus("MNRW", payload)` in the first block of
epoch `E + 1`, payload = SCALE of an enum variant (index 1), 105 bytes:

```
0x01 | epoch u64 LE @1 | leaf_count u64 LE @9 | root 32 @17 | min_key 28 @49 | max_key 28 @77
```
Fixed offsets; no compact parsing inside the payload. Pending node-team
confirmation (question 1 in the brief).

---

## 8. Reserve v2 timed release

`reserve_logic_v2` is rewritten (the current file was a test stub). It keeps
the v2 main/staging track switch (`logic_is_on_main`, `StagingState` NFT
one-shot mint) and adds the release path.

### 8.1 Redeemer and datum

```aiken
pub type ReserveRedeemer { Merge  Release { intervals: Int } }

pub type ReleaseState {              // inline datum on the reserve forever NFT UTXO
  last_release_time: Int,            // ms POSIX, start of the last released interval
  next_amount: Int,                  // NIGHT base units for the next interval
}

pub type StagingStateV2 {            // lib/rewards/types.ak; replaces StagingState for this logic
  cnight_test_policy: PolicyId,
  forever_script_hash: PolicyId,     // staging reserve forever
  pool_forever_hash: PolicyId,       // staging pool forever
}
```
Config per network (`aiken.toml`): `release_t0_ms`, `release_interval_ms`,
`release_initial_amount`, `release_decay_num`, `release_decay_den`.
Interval is one Midnight epoch (1–2 h). No separate lifetime cap: the
geometric series converges and every release is capped at the reserve
balance, which is the block-rewards allocation.

**Emission formula is a placeholder (TBD, pending Jon / FinDaS alignment):**
`amount_n = initial_amount × (decay_num / decay_den)^n`, floor at each step.

### 8.2 Release rules

1. `Release` requires both logic withdrawals as usual (forever pattern).
2. `now = validity_range.lower_bound` (finite, inclusive). `intervals ≥ 1`
   and `last_release_time + intervals × interval_ms ≤ now`. Partial catch-up
   is allowed (`intervals` may be less than elapsed); fully permissionless.
3. First release: the mainnet reserve NFT UTXO datum is the unit
   constructor (`Constr 0 []`). If the datum's constructor has no fields,
   treat it as `{ last_release_time: release_t0_ms, next_amount: release_initial_amount }`;
   otherwise decode `ReleaseState` (`Constr 0 [Int, Int]`).
4. `released = Σ_{i<intervals} next_amount × r^i` computed by a loop;
   `next_amount' = next_amount × r^intervals` (same loop);
   `last_release_time' = last_release_time + intervals × interval_ms`.
5. `released = min(released, NIGHT in reserve value inputs)`.
6. Inputs at the reserve forever address: the NFT UTXO (datum updated,
   value unchanged) and value UTXOs. Outputs: NFT UTXO with `ReleaseState'`;
   one value output with `[ada, night]`, `night_out == night_in − released`,
   `ada_out ≥ ada_in`; one output at the pool forever address whose NIGHT is
   `≥ released` (the pool logic (§9) merges it with the existing pool UTXO in
   the same tx).
7. Track: on main use `config.cnight_policy` / `config.reserve_forever_hash`
   / `config.rewards_pool_forever_hash`; otherwise read `StagingStateV2` from
   the logic's own NFT input.

`Merge` keeps the existing `logic_merge_v2` semantics (value can only grow,
NFT UTXO not consumed).

---

## 9. Rewards pool (`rewards_pool_*`, upgradable)

Forever/two-stage/logic triple cloned from reserve. The pool forever NFT
UTXO carries an unconstrained datum (reserved). Value UTXOs at the pool
address hold `[ada, night]`.

`rewards_pool_logic` withdraw redeemer:

```aiken
pub type PoolRedeemer { Receive  Disburse }
```
- `Receive`: merge semantics — sum of pool value inputs ≤ single pool value
  output, NFT UTXO not consumed. Used by the reserve release tx.
- `Disburse`: a withdrawal from `config.rewards_batcher_hash` exists. All value
  checks live in the batcher (§5.3 step 6).

Staging forever variant (`rewards_pool_staging_forever`) mirrors
`staging_reserve_ics.ak` so the release can be rehearsed on mainnet with
test tokens before promotion.

---

## 10. Transactions

| Tx | Inputs | Outputs | Scripts run |
|---|---|---|---|
| Init list | one-shot ref | head UTXO, tail UTXO | `virtual_account` mint |
| Register | anchor node, user funds | anchor', deposit, registration | `virtual_account` mint + anchor spend; stake auth |
| Top up / Withdraw / SetDeregister | deposit | deposit' | `virtual_account` spend; stake auth |
| Update / Delete registration | registration | registration' / burn | `virtual_account` spend (+ mint on delete); owner auth |
| Init batcher | one-shot ref | state UTXO | `rewards_batcher` mint |
| Load and pay (first batch) | as Pay batch; ref: bridge NFT | as Pay batch | as Pay batch |
| Pay batch | state, pool value, K deposits (+ predecessors for exits) | state', pool', K deposits' (or refunds), skim change | batcher withdraw; K account gates; pool forever spend + pool logic `Disburse` (+ mitigation) |
| Release | reserve NFT, reserve value, pool value | reserve NFT', reserve value', pool' | reserve forever spends + `reserve_logic_v2` `Release` + mitigation; pool forever spend + pool logic `Receive` + mitigation |

Every governance-domain spend still needs the domain's `logic` and
`mitigation_logic` withdrawals per `forever_contract`.

---

## 11. Invariants (test targets)

- **Uniqueness**: at most one deposit and one registration NFT per `skh`;
  head unique.
- **List order**: following `next` from head visits strictly ascending keys.
- **Exactly-once**: within an epoch a `skh` is paid at most once; a leaf is
  never skipped (contiguity + cursor + start check).
- **Completion**: `complete` becomes `True` only after every leaf between
  `start_key` around the circle back to `start_key` was paid.
- **Succession**: `epoch` increases by exactly 1 per load; load only when
  complete.
- **Pool conservation**: pool NIGHT decreases only in `Disburse` by exactly the
  sum of paid amounts; increases only via `Receive`.
- **Deposit conservation**: ADA decreases only by `skim` per payout or at
  exit; NIGHT decreases only by user `Withdraw` (to zero) or at exit.
- **Reserve flow limit**: NIGHT leaving the reserve ≤ schedule cumulative at
  `validity_range.lower_bound`.
- **Registration**: identity is the `0x01 ++ skh` NFT; only `owner` can change or
  delete; a registration NFT exists iff its deposit exists with
  `committed == None`.
- **Skim bound**: per paid account `≤ min(ceil(fee / n_paid), batcher_skim_max_lovelace)`.

---

## 12. Requirements on the rewards pallet (node team)

1. Leaves per §2.3 (45 bytes), sorted by `skh`, unique; tree per §6 (odd
   node promoted, `binary_merkle_tree::merkle_root::<Keccak256>`).
2. Digest `(epoch, leaf_count, root, min_key, max_key)` as a
   `Consensus("MNRW")` log per §7.1, empty-epoch form per §2.4, one digest
   per epoch, epochs consecutive. Details and questions: `node-team-brief.md`.
3. Emit a leaf only for deposits observed funded (≥ floor) at least 12 h
   ago; emit `ack = 1` exactly once per observed `committed = Some(addr)`
   and drop the account afterwards.
4. Read registration records from the new schema first, then
   `cnight_generates_dust`.
5. Treat NIGHT in deposit UTXOs as DUST-generating for the paired
   registration's `dust_address`.

---

## 13. Config keys (all 8 profiles)

```
virtual_account_one_shot_{hash,index}
rewards_batcher_one_shot_{hash,index}
rewards_pool_one_shot_{hash,index}
rewards_pool_staging_one_shot_{hash,index}
rewards_pool_two_stage_hash, rewards_pool_forever_hash   (derived by build)
rewards_batcher_hash, virtual_account_hash                (derived by build)
deposit_min_lovelace = 10_000_000
deposit_cap_lovelace = 40_000_000
batcher_skim_max_lovelace = 10_000                         (0.01 ADA; 5_000 is the alternative)
release_t0_ms, release_interval_ms, release_initial_amount, release_decay_num, release_decay_den   (TBD values; interval = one Midnight epoch)
rewards_digest_engine_id = "MNRW"
```

---

## 14. Decisions log (open-question interview, 2026-09-03)

| Question | Decision |
|---|---|
| Leaf hash | keccak-256 everywhere |
| Digest carrier | `Consensus("MNRW")` log, first block of `E + 1`; payload layout proposed, node team to confirm |
| Lifetime emission cap | none; balance and series bound it; interval = Midnight epoch |
| Batcher compensation | `≤ min(ceil(fee / n_paid), 0.01 ADA)` per paid account; no margin; Midnight funded floor ~3 ADA |
| Deposit sizes | min 10, cap 40 ADA |
| Mid-fold lock | none; griefing bounded and cheap to retry |
| Deregister | one user tx: flag deposit + burn registration (owner auth); no standalone registration delete |
| Exit | batcher unlinks deposit, burns its NFT, refunds to `addr` |
| SPO renewal field | out of scope now |
| Multi-partner-chain | one deployment per chain |
| Uncompensated load/release | accepted; batchers use `LoadAndPay` |
| Bridge MMR fold parity | bridge untouched; rewards use a positional verifier; flagged for bridge re-audit |
| Mainnet reserve datum | unit constructor; first release migrates by field count |
| Digest payload | enum variant 1, fixed 105 bytes with `leaf_count`; keys fixed 28; empty epoch = `leaf_count 0`, zero root |
| Leaf amount | fixed `u128` big-endian, leaf 45 bytes; 1 unit = 1 cNIGHT token unit = 1 STAR |
| Epoch counter | partner-chains sidechain epoch |
| Credential kind | `Deposit.cred: Credential`; keys stay 28-byte hashes everywhere else |
| Header | `Header<u32, BlakeTwo256>` confirmed in midnight-node |
| Bridge fold parity | sessions have no fixed parity; bridge swaps to the positional verifier in its own change after phase 03, then re-audit |
Test profiles (`local`, `devnet`) use short intervals (e.g. 60 s) and small
amounts.

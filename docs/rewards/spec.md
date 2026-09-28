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
rewards_batcher  (fixed)      no deps on new hashes; reads bridge via config.committee_bridge_forever_hash,
      ^                 ^     fee schedule via config.rewards_fee_schedule_hash
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
| `validators/virtual_account.ak` | `virtual_account` | mint, spend (gates), withdraw (user logic), publish |
| `validators/rewards_batcher.ak` | `rewards_batcher` | mint (state NFT), spend (state UTXO), withdraw (batch logic), publish |
| `validators/rewards_fee_schedule.ak` | `rewards_fee_schedule` | mint (schedule NFT), spend (replace datum under a bridge proof), publish. Fixed. (§4.6, not yet built) |
| `validators/rewards_pool.ak` | `rewards_pool_forever`, `rewards_pool_two_stage_upgrade`, `rewards_pool_logic` | forever pattern |
| `validators/staging_rewards_pool.ak` | `rewards_pool_staging_forever` | staging track |
| `validators/reserve_v2.ak` | `reserve_logic_v2` (rewritten; the current file was a test stub, never promoted) | withdraw, mint (StagingState), publish |

Libraries:

| File | Content |
|---|---|
| `lib/rewards/types.ak` | every datum / redeemer below (built) |
| `lib/rewards/linked_list.ak` | `key`, NFT names, `init_list` / `insert_ascending` / `unlink` (built, §4.2) |
| `lib/rewards/account.ak` | virtual account gates + withdraw logic (built) |
| `lib/rewards/value.ak` | `tokens_of`, `quantity`, `claim`, `split_ada`, `only_nft`: one walk over the value pairs, no stdlib lookups (built) |
| `lib/rewards/fold.ak` | `foldl2`: two-accumulator left fold in CPS (built) |
| `lib/rewards/test_fixtures.ak` | fixture builders for Aiken tests (built) |
| `lib/rewards/merkle_range.ak` | sorted multiproof verifier with contiguity (§6) |
| `lib/rewards/digest.ak` | MMR positional proof + SCALE header parse + digest extraction (§7) |
| `lib/rewards/batch.ak` | batcher withdraw logic (§5) |
| `lib/rewards/fee_schedule.ak` | `FeeSchedule` datum, `max_skim` lookup, schedule-update proof (§4.6; not yet built) |
| `lib/rewards/release.ak` | reserve v2 merge, release and pool ceiling (§8) |
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

Per Midnight epoch `E` (partner-chains sidechain epoch), the pallet submits
`Digest { epoch: E, leaf_count, root, min_key, max_key, treasury_total }`
as a bare inherent transaction (`pallet_block_rewards::submit_rewards_digest`)
in a Midnight block at or after the first block of epoch `E + 1`.
`min_key`/`max_key` are the first and last leaf `skh`. `treasury_total`
(u128, STAR) is the epoch's Treasury share, `Σ Nt` over its blocks; the
batcher's `Load` pays it from the pool to the ICS (§5.3). Empty epoch:
`leaf_count == 0`, `root` = 32 zero bytes, keys zero, `treasury_total`
possibly non-zero; its `Load` pays the share and leaves the state complete.
Extrinsic bytes in §7.1.
Full node-side contract: [node-team-brief.md](node-team-brief.md).

---

## 3. Virtual account — registration UTXO

Address: `virtual_account` script, no stake part (batcher never reads it;
users may attach their own stake credential — allowed, not required).

```aiken
AccountDatum::Registration {                  // skh lives only in the NFT name
  owner: Credential,                          // edit/delete authority after creation
  destinations: Pairs<ByteArray, Int>,        // kind_byte ++ address -> weight
  operator_keys: Pairs<ByteArray, ByteArray>, // "beefy" | "babe" | "aura" | "sidechain" | "spo" | … -> key bytes
  payout_threshold: Int,                      // STAR above dist_fee; the account enters a tree at dist_fee + payout_threshold (MIP Tree selection)
}
```
`destinations` routes the account's rewards: key = one kind byte (`0x00`
dust address, `0x01` stake / NIGHT address; further kinds are the node's)
followed by the address bytes; value = weight. The contract checks every
weight `> 0` and the weights sum to exactly `1000`; address formats and
kind semantics are the node's. `operator_keys` is opaque to the contract;
an empty list means "not an operator". `payout_threshold` is the owner's
choice with no protocol default; the contract checks only `≥ 0`, on create
and on every update.
Value: ADA + `0x01 ++ skh` NFT, nothing else.

| Action | Redeemer | Rule |
|---|---|---|
| create | only inside `Register` (§4.3) | minted together with the deposit node; stake auth; destination weights valid; `payout_threshold ≥ 0` |
| update | `UpdateRegistration` | `owner` auth; NFT continues to the same address; destination weights valid; `payout_threshold ≥ 0` |
| delete | only inside `SetDeregister` (§4.4) | `owner` auth; mint = −1 of `0x01 ++ skh`; the deposit with the same `skh` flips `committed` in the same tx |

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
pub fn init_list(inputs, mint, head: Output, tail: Output, own_policy, one_shot_ref) -> Bool
pub fn insert_ascending(anchor: Input, anchor_out: Output, node: Output, own_policy) -> Credential
pub fn unlink(pred: Input, pred_out: Output, own_policy, removed_key, removed_next) -> Bool
```
Callers pass indexed inputs and outputs; the list code never searches the
transaction. A node's kind comes from its NFT name (`""` head, `0x00 ++ skh`
deposit); the datum is decoded afterwards and must agree.
Rules enforced by the **account withdraw handler** (§4.4); mint and spend
only gate on the authority named by their redeemer:
- `init_list`: one-shot ref consumed; mint exactly
  `[("", 1), (0x00 ++ tail_key, 1)]`; two outputs at own address:
  `Head { next: tail_key }` with ADA + head NFT, `Tail` with ADA + tail NFT.
- `insert_ascending(anchor, anchor_out, node)`: `anchor` carries the head
  or a deposit NFT; `new_key = key(node.cred)`; `anchor.key < new_key`
  (head: always) and `new_key < anchor.next` (so `new_key < tail_key`);
  `anchor_out` identical except `next = new_key`; `node` at own address
  with `Deposit { cred, next: anchor.next, committed: None }`.
- `unlink(pred, pred_out, removed_key, removed_next)`: `pred.next ==
  removed_key`; `pred_out` identical except `next = removed_next`. The
  caller burns `0x00 ++ removed_key`. The tail node is never unlinked.

### 4.3 Register (withdraw action `Register`)

The action carries no fields: `cred` is read from the new node output's
datum, `skh = key(cred)`. Per anchor, mint = `[(0x00++skh, 1), (0x01++skh, 1)]`:
1. `stake_auth(cred, …)` for the `cred` in the node datum.
2. `insert_ascending(skh)`; the new deposit output has
   `deposit_min ≤ ADA ≤ deposit_cap` and NIGHT = 0.
3. Exactly one registration output (§3) carrying the `0x01 ++ skh` NFT.
4. `own_policy != config.cnight_policy` (hash-touch idiom).

### 4.4 User actions (account withdraw handler)

All user logic runs once per transaction in the `virtual_account` withdraw
handler (withdraw-zero pattern; the script stake credential is registered at
deployment). Mint and spend take a gate redeemer:

```aiken
pub type AccountGate { User  Batcher }
pub type AccountAction { kind: ActionKind, offset: Int }
pub type ActionKind { InitList  Register  Withdraw  TopUp  SetDeregister  UpdateRegistration }
```
`User`: a withdrawal from the `virtual_account` credential exists.
`Batcher`: a withdrawal from `config.rewards_batcher_hash` exists (batch
logic validates, §4.5). Nothing else is checked per input.

The withdraw redeemer is one action kind applied to **every** input at the
account address (`own inputs`, ledger order, `n` of them); the handler folds
over `tx.inputs` once and skips foreign inputs. Outputs are addressed by
index: `tx.outputs[offset..]` are consumed in order, one group per own
input; no output is found by search. The mint under the account policy must
be exactly what the action needs. Off-chain code uses one account per tx;
on-chain accepts any `n`.

| Kind | Own inputs | Outputs from `offset` | Own mint | Auth per account | Rule |
|---|---|---|---|---|---|
| `InitList` | none | head, tail | head + tail | none | §4.2 `init_list` |
| `Register` | `n` anchors | per anchor: anchor', node, registration | `+1` deposit and `+1` registration per node; exactly `2n` | stake auth for node `cred` | §4.3; one anchor links one key |
| `Withdraw` | `n` deposits with `committed = None` | `n` deposits' | none | stake auth for `cred` | same address, same datum, same NFT, NIGHT = 0, ADA unchanged |
| `TopUp` | `n` deposits with `committed = None` | `n` deposits' | none | stake auth for `cred` | same datum/NFT/NIGHT; `ADA_out − ADA_in ≥ deposit_min`; `ADA_out ≤ deposit_cap` |
| `SetDeregister` | `n` deposits and their `n` registrations, any order | one per deposit, in deposit order | `−1` per registration; exactly `n` | stake auth for `cred`; `owner` auth | `committed == None`; deposit continues with the same assets and `ADA_out ≥ max(ADA_in, deposit_min)`, `ADA_out ≤ max(ADA_in, deposit_cap)` (a deposit the skims took below the floor is topped up, so Midnight emits its ack leaf), datum `committed = Some(addr)` for an `addr` a ledger output can carry (28-byte payment hash; no stake part or an inline 28-byte hash), since the exit must pay it; every registration input's NFT is burned. The registration inputs themselves are forced by the ledger: a burn needs the NFT among the inputs |
| `UpdateRegistration` | `n` registrations | `n` registrations' | none | `owner` auth | NFT continues to the same address; destination weights `> 0`, sum `1000` |

Node kind is read from the NFT name, never from the datum alone.

**Limitation (deliberate, for contract simplicity):** `Register` links one
new key per anchor *input*. Two new keys that fall between the same adjacent
pair of existing nodes cannot be inserted in one tx, because the second
key's anchor would be the first key's fresh node, an output. Those keys go
in separate txs; anchors that are distinct existing nodes batch fine.

Mutual exclusion with the batcher needs no explicit check: the batcher
withdraw covers every `account_policy` input it accepts (§5.3), and every
user action covers every account-address input, so a list UTXO is validated
by exactly one authority and a tx mixing both fails on whichever side sees
an input it does not own.

`Withdraw` is total-balance only; combined with the cap on top-ups and the
once-per-lifetime flag, user-caused spends of a deposit are bounded.
Withdrawal destination is unconstrained.

### 4.5 Batcher paths on a deposit (checked inside `rewards_batcher` withdraw, §5.4)

Both paths read the fee schedule (§4.6) as a reference input. With
`n_paid` the number of leaves paid in this tx (exits included):

```
skim ≤ max_skim[n_paid]                       // lovelace, per deposit
fee  = if amount ≥ min_payout then dist_fee else 0   // NIGHT, per leaf
```

- **Pay**: `ADA_in − skim ≤ ADA_out ≤ ADA_in`; `NIGHT_out = NIGHT_in + amount − fee`;
  datum, address, NFT unchanged.
- **Exit** (leaf `ack = 1`): requires `committed == Some(addr)`; no
  continuing deposit output; burn `0x00++skh`; `unlink(skh, next)`; an
  output to `addr` with `ADA_in − skim ≤ ADA ≤ ADA_in` and
  `NIGHT ≥ NIGHT_in + amount − fee`. The registration is already gone
  (burned in the `SetDeregister` tx).

The skim is cost recovery: the batcher's own input/output pair (§5.3 run
rule 2) may not gain ADA, so the tx fee is covered by the skims plus
whatever the batcher pays itself. `max_skim` is set by Midnight to the
real per-account fee share at the target batch size and below real cost
for smaller batches, so a one- or two-account batch is buildable at the
batcher's expense and a padded fee is bounded per deposit by the largest
entry. There is no minimum batch size. The distribution fee is the
batcher's upside: it stays in the batcher's pair, is charged only on
leaves at or above `min_payout` (slack leaves and small exits pay
nothing), and is linear in the leaves so charged.

Head spend: only as the `Register` anchor (gate `User`) or as exit
predecessor (gate `Batcher`). Tail: no action accepts it; the batcher never
unlinks it.

### 4.6 Fee schedule UTXO (`rewards_fee_schedule`, fixed; not yet built)

One UTXO, NFT `("", 1)` under its own policy, minted one-shot from
`config.rewards_fee_schedule_one_shot_{hash,index}`. Inline datum:

```aiken
pub type FeeSchedule {
  max_skim: List<Int>,     // lovelace; index n − 1 is the cap for a batch paying n leaves; last entry applies beyond
  dist_fee: Int,           // NIGHT base units per leaf at or above min_payout
  min_payout: Int,         // NIGHT base units
}
```

All three are Midnight runtime parameters. The datum is replaced only
under a bridge proof of the pallet's `submit_fee_schedule` inherent
(`config.fee_schedule_pallet_index` / `fee_schedule_call_index`, **TBD**
node team), verified with the same `verify_digest` machinery as §7 but
decoding a `FeeSchedule` payload; the NFT continues, value unchanged. Init
mint validates shapes only. The batcher reads the UTXO as a reference
input (`config.rewards_fee_schedule_hash`).

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
  cursor: ByteArray,              // last skh paid; empty after the Load
  complete: Bool,                 // init = True
}
```
`cursor` is read only while `complete == False`. Init mint validates only
shapes (28-byte hashes, `complete == True`). Deployer sets the hashes;
governance owns deployment.

The fold runs once from `min_key` to `max_key`: the run that pays `max_key`
completes the epoch. The cursor is the last key paid, as in the MIP.

### 5.2 Spend / publish

- `Spending` the state UTXO: a withdrawal from own script hash exists. All
  logic runs in the withdraw branch once per tx.
- `Publishing RegisterCredential` → `True`.

### 5.3 Withdraw redeemer

```aiken
pub type BatcherRedeemer {
  Load { digest_proof: DigestProof }   // digest: §7
  Pay { proof: ProofNodeRec }
}
```
The redeemer names no input or output. The transaction layout binds them:

| Output | `Load` | `Pay` |
|---|---|---|
| 0 | the state: same address as the state input, ADA and the state NFT only | same |
| 1 | the pool, when `treasury_total > 0` | the pool |
| 2… | the ICS output, when `treasury_total > 0` | per paid leaf, in leaf order: its deposit (`ack = 0`); or for an exit (`ack = 1`) its predecessor, unless that is the previous paid leaf, then its refund |
| rest | free (the batcher's change) | free |

**Load** (opens an epoch; pays no leaf)
1. `state_in.complete == True`.
2. `digest = verify_digest(bridge_state.latest_mmr_root, digest_proof)`
   where `bridge_state` is the inline datum of the reference input holding
   the `config.committee_bridge_forever_hash` singleton NFT.
3. `digest.epoch == state_in.epoch + 1` (strict succession).
4. No input holds an `account_policy` token, and the mint holds none.
5. Treasury: with `treasury_total == 0` no pool input. Otherwise the pool
   pays it (pool rule below, `amount = treasury_total`) and output 2 is at
   `Address(Script(config.ics_forever_hash), None)` holding
   `[ada, treasury_total]` with no datum hash, the shape the ICS
   `logic_merge` accepts. No input may sit at the ICS credential, so no ICS
   merge shares the transaction and claims the same output.
6. `state_out == state_in with { epoch, root, min_key, max_key, cursor: "",
   complete: leaf_count == 0 }`.

**Pay** (every later batch)
1. `state_in.complete == False`.
2. `leaves = verify_range(root, proof)` (§6): ascending, contiguous. The
   epoch's first run (`cursor == ""`) starts at `min_key` and pays every
   revealed leaf. A later run starts at the cursor's leaf, already paid,
   and pays the leaves after it. A run pays at least one leaf; the cursor
   moves to the last leaf paid, and `complete := cursor == max_key`.
3. One fold over four lists: the paid leaves; the mint under
   `account_policy`; the inputs holding an `account_policy` token, sorted
   by NFT name (so the ledger's input order does not matter); and the
   outputs from index 2. Going forward, each paid leaf takes its items:
   - `ack = 0`: its deposit `0x00 ++ key` (next input) and its continuing
     output (next output).
   - `ack = 1`: the burn `(0x00 ++ key, −1)` (next mint entry). If the next
     input is its own deposit, its list predecessor is the previous paid
     leaf; it then takes the refund (next output). Otherwise the next two
     inputs are its predecessor (head or deposit) and its deposit, and the
     next two outputs the relinked predecessor and the refund.
   The mint and the inputs must end empty, so every account input, burn
   and output has exactly one role: an extra deposit, a registration, an
   unused head, a mint or a second burn fails.
   Coming back, each leaf receives its successor's relink: an exit whose
   predecessor is the previous paid leaf names itself and the `next` that
   predecessor takes. A paid deposit applies it in its one output (§4.5
   Pay, with `next` replaced); an exit passes it on through its own `next`,
   so exits in a row relink their shared predecessor once. The run's first
   leaf may not receive a relink: its predecessor is not in the batch.
   Deposit spends and the exit burn use the account gate `Batcher` (§4.4);
   the tail is never an input.
4. Pool: all inputs at `Script(pool_forever)` are summed (none may carry
   the pool forever NFT); output 1 is at `Address(Script(pool_forever),
   None)` with `NIGHT_out == NIGHT_in − amount` (`Σ amount` of the paid
   leaves), `ADA_out ≥ ADA_in`, value shape `[ada, night]`, inline datum.
   Σ fee (§4.5) is what the pool lost less what the deposits gained. Pool
   logic is satisfied separately (§9).
5. `state_out == state_in with { cursor, complete }`; NFT continues.

### 5.4 Costs

Per deposit input the spend script runs a constant-size gate (withdrawal
lookup, ~0.13 M mem). The withdraw script does one multiproof verification,
sorts the account inputs, and folds once over the paid leaves. Measured
(`budget_30_pairs` minus its fixture): 30 paid leaves from a 64-leaf tree
cost ≈ 5.3 M mem / 2.0 G cpu in the batcher alone; with 30 gates the tx
uses about 9.2 M of the 14 M mem limit. The test gives the deposits in
ascending order, the best case of the stdlib insertion sort; the ledger
orders inputs by transaction id, so the worst case is higher.
Recommended K ≈ 20–25 accounts per batch on mainnet limits. `max_skim` (§4.5) covers cost only at the target K, and
the distribution fee is linear in leaves paid, so incentives point toward
the largest batch that fits.

The reserve `Release` and every `Load` are uncompensated; a batcher
recovers their cost from the skims and fees of the `Pay` batches.

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

The digest for epoch `E` is a **transaction in a Midnight block**: the bare
inherent `pallet_block_rewards::submit_rewards_digest { epoch, leaf_count,
root, min_key, max_key, treasury_total }`, committed by the block header's
`extrinsics_root`. Chain of custody for a digest in block `N`:
1. MMR leaf for block `N + 1` (`BeefyMmrLeaf`, SCALE via
   `bridge/codec.scale_encode_beefy_mmr_leaf`) carries
   `parent_number == N` and `parent_hash == blake2b_256(header_N)`.
2. MMR inclusion proof of that leaf at index `parent_number` against
   `latest_mmr_root` with leaf count `latest_height`, both read from the
   bridge datum (`bridge/merkle.verify_mmr_leaf`, bridge spec §13).
3. `header_N` supplied as raw SCALE bytes; `blake2b_256(header_N) == parent_hash`,
   `number == parent_number`; `extrinsics_root` read at a fixed offset.
4. Trie inclusion proof (`lib/rewards/trie.ak`, Substrate `LayoutV1`,
   blake2b-256) of the extrinsic bytes under key `Compact(extrinsic_index)`.
5. Decode the extrinsic as the bare `submit_rewards_digest` call
   (`config.rewards_pallet_index`, `config.rewards_call_index`); anything
   else fails.

```aiken
pub type DigestProof {
  leaf: BeefyMmrLeaf,             // index = parent_number; count = the bridge's latest_height
  items: List<ByteArray>,         // MMR proof items (siblings + peaks) per sp_mmr_primitives::Proof
  header: ByteArray,              // SCALE header of block N
  extrinsic_index: Int,           // position of the rewards extrinsic in block N
  trie_nodes: List<ByteArray>,    // hash-referenced trie nodes, root first
  extrinsic: ByteArray,           // the extrinsic bytes as noted by frame_system
}
pub fn verify_digest(mmr_root: ByteArray, latest_height: Int, proof: DigestProof) -> Digest
```

MMR verification, header, trie and extrinsic layouts: see §7.1.

Any block at or below the bridge checkpoint is provable and the contract
does not bind the block to the epoch boundary: the first extrinsic that
decodes to a digest with `epoch == state.epoch + 1` is accepted, so the
node may emit the digest after any observation lag. Payouts may lag any
number of epochs without losing provability.

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
The count is the bridge datum's `latest_height` and the index is the
leaf's `parent_number`; the redeemer supplies neither. A count from the
redeemer is unsafe: two counts that put the leaf under the same peak with
the same peaks to its right give the same root (leaf 99 verifies with
count 336 against the root of 335 leaves). The walk is the MIP bridge's
`bridge/merkle.verify_mmr_leaf` (the index-and-count walk of bridge rule
8), which rejects `leaf_index ≥ leaf_count` and requires every item to be
consumed. The MMR starts at block 1: block `b` adds leaf `b − 1`, and the
root at `latest_height` has `latest_height` leaves. Checked on a
local-env node: 20 `mmr_generateProof` proofs at six heights (one peak,
many peaks, the latest leaf) verify against `mmr_root` and the `mh`
payload of the BEEFY justification.

**BEEFY MMR leaf**: `version: u8` (major << 5 | minor), `parent_number_and_hash: (BlockNumber u32 LE, H256)`,
`beefy_next_authority_set { id: u64, len: u32, keyset_commitment: H256 }`,
`leaf_extra`. Already encoded by `bridge/codec.scale_encode_beefy_mmr_leaf`;
`leaf_hash = keccak256(SCALE(leaf))`.

**Header** (`sp_runtime::generic::Header<u32, BlakeTwo256>`, confirmed in
`midnight-node/runtime/src/lib.rs:138,1245`):

```
parent_hash(32) || Compact(number) || state_root(32) || extrinsics_root(32) || Compact(n_logs) || log*
header_hash = blake2b_256(bytes)
```
Compact<u32/u64>: low two bits of the first byte select 1/2/4-byte LE
(`00/01/10`, value = raw >> 2) or big-int mode (`11`, byte count =
(first >> 2) + 4, LE). The parser needs only: skip 32, compact, skip 32,
read 32 (`extrinsics_root`). Logs are not read.

**Extrinsics trie** (`frame_system::finalize`: `BlakeTwo256::ordered_trie_root(xts, StateVersion::V1)`;
`system_version = 3` in the runtime selects V1): keys `Compact(i)` for
extrinsic `i`, values the bytes noted by `note_extrinsic` = `xt.encode()`
**including** its `Compact(len)` prefix. `sp_trie::LayoutV1`, no extension
nodes, blake2b-256, node layout:

```
header   01nnnnnn leaf, value inline          001nnnnn leaf, value hashed (value ≥ 33 bytes)
         10nnnnnn branch without value        11nnnnnn / 0001nnnn branch with value (never: keys are prefix-free)
         n = partial nibble count; n == max means a varint continues (never: keys ≤ 4 bytes)
partial  ceil(n / 2) bytes; odd n → first byte is 0x0k (k = first nibble)
leaf     Compact(len) || value            or   32-byte blake2b-256(value)
branch   bitmap u16 LE (bit i = child i), then per present child Compact(len) || bytes;
         len == 32 → hash reference, len < 32 → child node inline
root     blake2b-256 of the root node bytes
```
The proof is the list of hash-referenced nodes root first; inline children
are embedded. Golden vectors from `sp_trie` (polkadot-sdk `660acef`) with
1, 3, 5, 17 and 70 extrinsics live in `lib/rewards/trie.test.ak`.

**Rewards extrinsic** (bare `UncheckedExtrinsic`; `new_bare` writes
preamble `0x05`, the legacy `0x04` is also accepted):

```
Compact(123) | preamble 0x05 | pallet u8 | call u8 | epoch u64 LE | leaf_count u64 LE | root 32 | min_key 28 | max_key 28 | treasury_total u128 LE
```
= 125 bytes; `pallet == config.rewards_pallet_index`,
`call == config.rewards_call_index` (both `# TBD` until the runtime pins
the pallet index). Fixed offsets after the 2-byte length prefix:
preamble@2, pallet@3, call@4, epoch@5, leaf_count@13, root@21, min@53,
max@81, treasury_total@109. Any other length, preamble or index fails.

---

## 8. Reserve v2 release to the pool ceiling

`reserve_logic_v2` (`validators/reserve_v2.ak`, logic in
`lib/rewards/release.ak`) replaces the always-true stub. It keeps the v2
main/staging track switch (`logic_is_on_main`, staging-state NFT one-shot
mint) and adds the release path.

### 8.1 Redeemer and datum

```aiken
pub type ReserveRedeemer { Merge  Release { intervals: Int } }

pub type ReleaseState {              // inline datum on the reserve forever NFT UTXO
  NotStarted { zero_a: Int, zero_b: Int }   // the deploy datum Constr 0 [0, 0]: releases not started
  Releasing {
    last_release_time: Int,          // ms POSIX, start of the last released interval
    reserve_floor: Int,              // NIGHT the reserve kept after the last release
  }
}

@list
pub type StagingStateV2 {            // lib/rewards/types.ak; replaces StagingState for this logic; mint-staging-state writes it
  cnight_test_policy: PolicyId,
  forever_script_hash: PolicyId,     // staging reserve forever
  pool_forever_hash: PolicyId,       // staging pool forever
}
```
Config per network (`aiken.toml`): `release_interval_ms`,
`release_factor_num`, `release_factor_den`. The start time is not config:
it is the `last_release_time` written at deploy. Interval is one Midnight epoch
(six hours per the MIP). No lifetime cap: every release is capped at the
reserve balance, which is the block-rewards allocation.

**Pool ceiling.** The pallet applies the published per-block rate `R` to
the undistributed allocation; the contract only guarantees the pool can
cover an interval in which every slot produces. That worst case is
`reserve × (1 − (1 − R)^N)` for `N` slots per interval, and it is the
ceiling the pool is filled to. The factor is precomputed off-chain and
rounded up, `release_factor_num / release_factor_den ≥ 1 − (1 − R)^N`
(at `π = 3%`, `N = 3,600`, `den = 10^18`: `num = 57,532,591,972,042`).
Because rewards decay, a ceiling computed from the live reserve is always
at least the next interval's need.

### 8.2 Release rules

1. `Release` requires both logic withdrawals as usual (forever pattern). `Merge` and
   `Release` run only as the withdrawal; publishing a `RegisterCredential`
   passes and any other certificate, an unregistration included, fails.
2. `now = validity_range.lower_bound` (finite, inclusive). `intervals ≥ 1`
   and `last_release_time + intervals × interval_ms ≤ now`. Partial catch-up
   is allowed (`intervals` may be less than elapsed); fully permissionless.
3. State: a release needs `Releasing { last_release_time, reserve_floor }`.
   The reserve deploy writes it: `last_release_time` is the deploy time and
   `reserve_floor` the NIGHT already at the reserve address. A reserve that
   still holds the deploy datum `Constr 0 [0, 0]` (`NotStarted`) cannot
   release; a governance path that writes its first state comes later. The
   reserve value inputs must hold at least `reserve_floor` NIGHT, so a
   release cannot size its ceiling on a small UTxO; the output state
   records what the reserve keeps (`reserve − released`) as the next floor.
4. `ceiling` over `intervals` catch-up steps, each a ceiling division on
   what the previous step left: `c := 0; repeat intervals: c += ((reserve − c) × num + den − 1) / den`.
   `last_release_time' = last_release_time + intervals × interval_ms`.
5. `released = min(reserve, max(0, ceiling − pool_in))` where `reserve` is
   the NIGHT in the reserve value inputs and `pool_in` the NIGHT in the
   pool value inputs of this tx (the pool is already an input for the
   merge). A release of 0 still advances `last_release_time`.
6. Inputs at the reserve forever address: the NFT UTXO (datum updated,
   assets unchanged, ADA not down: a larger datum may need more minimum
   ADA) and value UTXOs. Outputs: NFT UTXO with `ReleaseState'`;
   one value output with `[ada, night]`, `night_out == night_in − released`,
   `ada_out ≥ ada_in`; one output at the pool forever credential, at
   `Address(Script(pool_forever), None)`, whose NIGHT is
   `≥ pool_in + released` (the pool logic (§9) merges it with the existing
   pool UTXO in the same tx).
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
- `Receive`: merge semantics — sum of pool value inputs ≤ the first
  `[ada, night]` output at `Address(Script(forever), None)` (inline datum,
  no stake part), NFT UTXO not consumed. Used by the reserve release tx. Main track: config hashes;
  staging track: hashes from the logic's own `StagingState` NFT input
  (one-shot `config.rewards_pool_logic_one_shot_*`), as `logic_merge_v2`.
- `Disburse`: a withdrawal from `config.rewards_batcher_hash` exists. All value
  checks live in the batcher (§5.3 run rule 3).

Only the withdrawal runs these checks. Publishing a `RegisterCredential`
passes; any other certificate, an unregistration included, fails, so the
logic's stake credential stays registered.

Staging forever variant (`rewards_pool_staging_forever`) mirrors
`staging_reserve_ics.ak` so the release can be rehearsed on mainnet with
test tokens before promotion.

---

## 10. Transactions

| Tx | Inputs | Outputs | Scripts run |
|---|---|---|---|
| Init list | one-shot ref | head UTXO, tail UTXO | `virtual_account` withdraw `InitList` + mint gate |
| Register | anchor node, user funds | anchor', deposit, registration | `virtual_account` withdraw `Register` + mint/spend gates; stake auth |
| Top up / Withdraw | deposit | deposit' | `virtual_account` withdraw + spend gate; stake auth |
| SetDeregister | deposit, registration | deposit' (burn registration) | `virtual_account` withdraw + gates; stake auth + owner auth |
| Update registration | registration | registration' | `virtual_account` withdraw + spend gate; owner auth |
| Init batcher | one-shot ref | state UTXO | `rewards_batcher` mint |
| Load | state, pool value (when `treasury_total > 0`); ref: bridge NFT | state', pool' and the ICS output (when `treasury_total > 0`) | batcher withdraw; pool forever spend + pool logic `Disburse` (+ mitigation) when the pool pays |
| Pay batch | state, pool value, K deposits (+ predecessors for exits), batcher's own input; ref: fee schedule | state', pool', K deposits' (or refunds), batcher's own output last (skim change + fees) | batcher withdraw; K account gates; pool forever spend + pool logic `Disburse` (+ mitigation) |
| Fee schedule update | schedule UTXO; ref: bridge NFT | schedule UTXO' | `rewards_fee_schedule` spend with a bridge proof of `submit_fee_schedule` |
| Release | reserve NFT, reserve value, pool value | reserve NFT', reserve value', pool' | reserve forever spends + `reserve_logic_v2` `Release` + mitigation; pool forever spend + pool logic `Receive` + mitigation |

Every governance-domain spend still needs the domain's `logic` and
`mitigation_logic` withdrawals per `forever_contract`.

---

## 11. Invariants (test targets)

- **Uniqueness**: at most one deposit and one registration NFT per `skh`;
  head unique.
- **List order**: following `next` from head visits strictly ascending keys.
- **List invariants under any mix**: the account withdraw (its action's
  exact set) and the batcher withdraw (its fold, §5.3) each bind every
  account input, burn and output; a tx carrying both passes only when it
  satisfies both.
- **Exactly-once**: within an epoch a `skh` is paid at most once; a leaf is
  never skipped (contiguity + cursor).
- **Completion**: `complete` becomes `True` only in the run that pays
  `max_key`; the fold starts at `min_key` (set by the `Load`), so every
  leaf was paid.
- **Succession**: `epoch` increases by exactly 1 per load; load only when
  complete.
- **Pool conservation**: pool NIGHT decreases only in `Disburse`, by exactly
  the sum of paid amounts in a `Pay` or `treasury_total` in a `Load`;
  increases only via `Receive`.
- **Deposit conservation**: ADA decreases only by `skim` per payout or at
  exit; NIGHT decreases only by user `Withdraw` (to zero), by `dist_fee` on
  a payout at or above `min_payout`, or at exit.
- **No ADA to the batcher**: every input/output pair, the batcher's own
  included, has `ADA_out ≤ ADA_in`.
- **Pool ceiling**: after a release the pool holds at most
  `ceiling(reserve, intervals)`; NIGHT leaving the reserve per release is
  `ceiling − pool_in` at most.
- **Registration**: identity is the `0x01 ++ skh` NFT; only `owner` can change or
  delete; a registration NFT exists iff its deposit exists with
  `committed == None`.
- **Skim bound**: per paid account `≤ max_skim[n_paid]` from the fee schedule.
- **Fee bound**: per paid leaf exactly `dist_fee` if `amount ≥ min_payout`, else 0.

---

## 12. Requirements on the rewards pallet (node team)

1. Leaves per §2.3 (45 bytes), sorted by `skh`, unique; tree per §6 (odd
   node promoted, `binary_merkle_tree::merkle_root::<Keccak256>`).
2. Digest `(epoch, leaf_count, root, min_key, max_key, treasury_total)`
   as the bare inherent `submit_rewards_digest` per §7.1, empty-epoch form
   per §2.4, one digest per epoch, epochs consecutive. Details and
   questions: `node-team-brief.md`.
2a. Fee schedule `(max_skim, dist_fee, min_payout)` as a bare inherent
   `submit_fee_schedule` whenever governance changes it (§4.6), with
   `min_payout` the same value the tree selection uses.
3. Emit a leaf only for deposits observed funded (≥ floor) at least 12 h
   ago; emit `ack = 1` exactly once per observed `committed = Some(addr)`
   and drop the account afterwards.
4. Read registration records from the new schema first, then
   `cnight_generates_dust`.
5. Route rewards of a deposit per its registration's `destinations`
   (weights out of 1000; kind byte selects dust generation vs NIGHT
   delivery).

---

## 13. Config keys (all 8 profiles)

```
virtual_account_one_shot_{hash,index}
rewards_batcher_one_shot_{hash,index}
rewards_pool_one_shot_{hash,index}
rewards_pool_staging_one_shot_{hash,index}
rewards_pool_logic_one_shot_{hash,index}
rewards_pool_two_stage_hash, rewards_pool_forever_hash   (derived by build)
rewards_batcher_hash, virtual_account_hash                (derived by build)
deposit_min_lovelace = 10_000_000
deposit_cap_lovelace = 40_000_000
rewards_fee_schedule_one_shot_{hash,index}, rewards_fee_schedule_hash   (not yet built; replaces batcher_skim_max_lovelace)
release_interval_ms, release_factor_num, release_factor_den
ics_forever_hash                                          (Treasury output target; existing ICS deployment)
rewards_pallet_index, rewards_call_index                 (# TBD node team; pallet_block_rewards, submit_rewards_digest)
fee_schedule_pallet_index, fee_schedule_call_index       (# TBD node team; submit_fee_schedule)
```
The profiles still carry `batcher_skim_max_lovelace`; it goes with the
fee-schedule phase. Test profiles use `release_interval_ms = 60_000` with
the factor for ten 6-second slots (`159_817_340_105 / 10^18`, the §8.1
rate); `preprod` and `mainnet` carry the §8.1 six-hour vector, `# TBD`.
Every profile carries all keys. Derived hashes are written back by the build (phase 04): `rewards_pool_*`
with the two-stage / forever phases, `rewards_batcher_hash` and
`virtual_account_hash` after the threshold phase, before the final compile.

---

## 14. Decisions log (open-question interview, 2026-09-03)

| Question | Decision |
|---|---|
| Leaf hash | keccak-256 everywhere |
| Digest carrier | bare inherent `pallet_block_rewards::submit_rewards_digest` in a Midnight block, proven through `extrinsics_root` (revised 2026-09-11; was a `Consensus("MNRW")` header log) |
| Lifetime emission cap | none; the reserve balance and the pool ceiling bound it; interval = Midnight epoch (six hours) |
| Batcher compensation | ADA: skim `≤ max_skim[n_paid]` from the fee schedule UTXO, batcher pair never gains ADA. NIGHT: `dist_fee` per leaf at or above `min_payout`, kept by the batcher (revised 2026-09-16; was `min(ceil(fee / n_paid), 0.01 ADA)`, no margin) |
| Deposit sizes | min 10, cap 40 ADA |
| Mid-fold lock | none; griefing bounded and cheap to retry |
| Deregister | one user tx: flag deposit + burn registration (owner auth); no standalone registration delete |
| Exit | batcher unlinks deposit, burns its NFT, refunds to `addr` |
| SPO renewal field | out of scope now |
| Multi-partner-chain | one deployment per chain |
| Uncompensated load/release | accepted; batchers use `LoadAndPay` |
| Bridge MMR walk | the digest proof uses the MIP bridge's `merkle.verify_mmr_leaf`, count `latest_height`, index `parent_number`; the rewards copy of the walk is gone |
| Mainnet reserve datum | unit constructor; first release migrates by field count |
| Digest payload | call args `epoch u64, leaf_count u64, root [u8;32], min_key [u8;28], max_key [u8;28], treasury_total u128` (120 bytes; was 104 before 2026-09-16); empty epoch = `leaf_count 0`, zero root |
| Leaf amount | fixed `u128` big-endian, leaf 45 bytes; 1 unit = 1 cNIGHT token unit = 1 STAR |
| Epoch counter | partner-chains sidechain epoch |
| Credential kind | `Deposit.cred: Credential`; keys stay 28-byte hashes everywhere else |
| Header | `Header<u32, BlakeTwo256>` confirmed in midnight-node |
| Bridge fold parity | sessions have no fixed parity; bridge fold fixed in `6b5bf68a0b89` after phase 03; re-audit pending |

### Phase 00/01 review adjustments (2026-09-09, as built)

| Change | Reason |
|---|---|
| Account user logic moved to the `virtual_account` withdraw handler; mint and spend are gates (`AccountGate { User, Batcher }`) | one validation per tx regardless of input count; same pattern as the batcher |
| One `AccountAction { kind, offset }` per tx applied to every account-address input; outputs consumed from `offset` 1:1 in ledger order | no output search; deterministic cost |
| `Register` and `SetDeregister` carry no fields: `cred` and refund `addr` come from the output datums | redundant redeemer data removed |
| Tail sentinel node (`0x00 ++ 0xff×28`, datum `Tail`) minted with the head; `next: ByteArray` instead of `Option` | uniform `key < next` comparison, no `None` branch |
| `Register` links one new key per anchor input; keys between the same adjacent pair need separate txs | simplicity; anchors that are distinct nodes still batch |
| Registration datum = `{ owner, destinations: Pairs<kind ++ addr, weight>, operator_keys: Pairs<name, bytes> }`; weights `> 0`, sum `1000`; `skh` only in the NFT name | node routes rewards per weights; one schema for delegator, DUST-only, operator personas |
| No standalone `LoadEpoch`; `BatcherRedeemer { Pay, LoadAndPay }`; `start_key`/`cursor` are plain bytes, valid only while `complete == False` | `complete` alone distinguishes between-epochs from mid-run |
| `PoolRedeemer { Receive, Disburse }` | name clash with the batcher's `Pay` |
| No `lib/rewards/hash.ak`; `builtin.keccak_256` inline | wrapper added nothing |
| `lib/rewards/value.ak`, `lib/rewards/fold.ak` helpers | one walk over value pairs; CPS two-accumulator fold |
| Build-engine `FIXED` table gets each hash with its validator (`virtual_account_hash` in 01; batcher and pool in 04) | `updateHash` throws on a missing blueprint title |

### Phase 02 review adjustments (2026-09-09, as built)

| Change | Reason |
|---|---|
| Contiguity fold runs inside the DFS in its right-to-left visit order; `Inside` carries the leftmost key seen so ascending keys are checked in the same fold | `hash* leaf+ hash*` is its own reverse; one pass |
| Terminal items are length-checked (leaf 45, hash 32) as they are visited | rejects shape confusion before the root comparison |
| `parse_leaf` does not re-check length | `verify_range` already did |

### Phase 03 review adjustments (2026-09-10, as built)

| Change | Reason |
|---|---|
| MMR proof walked by leaf index (peaks from the binary digits of `leaf_count`, left/right from the bits of the leaf's offset) instead of node positions; positional form kept as the test oracle | same root on every case tested; positional cost 8.76 M mem at one million leaves, index walk 0.43 M |
| Right peaks consume exactly one item (the prover bags two or more into one; a single right peak is its plain hash); every item must be consumed | matches `polkadot-ckb-merkle-mountain-range` 0.8.2 `gen_proof` / `calculate_peaks_hashes` |
| No `mmr_size` validity check | the count is the bridge's `latest_height`; `2n − popcount(n)` is always a valid size |
| `header_number` parsed and bound to `leaf.parent_number` | cheap; closes the header/leaf link both ways |
| Unknown digest tags fail even while skipping | a parser that skips what it cannot measure would desynchronise |

### Phase 04 review adjustments (2026-09-10, as built)

| Change | Reason |
|---|---|
| `cursor` is the next key to pay; a run is `[cursor … lookahead]`, the lookahead is unpaid and becomes the cursor; a run ending at `max_key` pays it and wraps to `min_key`; a lookahead equal to `start_key` completes | with `cursor = last paid`, a batch that stopped one leaf short of `start_key` left only an empty batch, which rule 1 rejected: the epoch could never complete |
| `ExitInfo { pred_input_index, pred_output_index }`; the exit's refund is the `PayPair` output | one strictly increasing output sequence covers deposits and refunds (no shared refund output) |
| Pool logic `Receive` checks the first output at the forever credential and requires an inline datum | same as the batcher's pool rule; `logic_merge_v2` shape |
| `rewards_pool_logic_one_shot_{hash,index}` config keys | the pool logic's staging `StagingState` NFT needs its own one-shot, as `reserve_logic_v2` has |
| Build: `FIXED` hashes written after the threshold phase | `virtual_account` and `rewards_pool_logic` embed `rewards_batcher_hash`; the final compile must see it |

### Digest carrier revision (2026-09-11)

| Change | Reason |
|---|---|
| The digest is a transaction in a Midnight block (bare inherent of the new cNIGHT-only `pallet_block_rewards`), proven via `extrinsics_root` with a `LayoutV1` trie proof; the `MNRW` header log is gone | the rewards must be a ledger-visible transaction, not a consensus log; the old mNIGHT `pallet_block_rewards` is replaced under the same name |
| `DigestProof { …, extrinsic_index, trie_nodes, extrinsic }` replaces `log_index` | trie proof + extrinsic bytes instead of a log index |
| `config.rewards_pallet_index` / `rewards_call_index` replace `rewards_digest_engine_id` | the call is identified by pallet and call index |
| No block-position rule: any block, first extrinsic that decodes to `epoch + 1` | the node may emit the digest after an observation lag |
| `lib/rewards/trie.ak` + test-only `trie_builder.ak`, validated against `sp_trie` golden vectors | new verifier |

### Batcher review (2026-09-28, as built)

| Change | Reason |
|---|---|
| `Pay` is one fold over the paid leaves, the account mint, the sorted account inputs and the outputs from index 2; fixed outputs (state 0, pool 1); `PayPair` and `ExitInfo` removed | redeemer indices let one input or output take two roles, and leftover account inputs were never checked |
| The fold takes items going forward and checks them coming back: an exit returns a relink to its predecessor, which a paid deposit applies in its one output and an exit passes on | a paid predecessor and its exiting successor in one batch needed two outputs for one NFT, and the run that pays `max_key` always pays the leaf before it |
| The batch's account mint is exactly its exit burns | the `Batcher` account gate trusts the batcher, so a batch could mint account NFTs |
| `Load` loads the digest and pays the Treasury share, and pays no leaf; `start_key` and `treasury_total` leave the state; the fold runs once from `min_key` to `max_key` | the share does not depend on the fold; one payment path and no wrap |
| `cursor` is the last key paid (MIP); a later run reveals the cursor's leaf and pays the leaves after it; no lookahead | without `start_key` and the wrap, the lookahead's reason (a batch one leaf short of `start_key`) is gone; any run may end anywhere, `max_key` included |
| A `Load` that pays the Treasury share spends no ICS input and pays exactly `treasury_total` | the ICS `logic_merge` claims the first ICS output, so a merge in the same tx could also pass the payment check |
| The batcher's own output is the last output of a `Pay` (rule for the batcher pair, built with the fee schedule) | the fixed layout leaves the change at the end |

### MIP alignment (2026-09-16, not yet built)

| Change | Reason |
|---|---|
| Skim cap is `max_skim[n_paid]` from a fee schedule UTXO (§4.6), no fee-share term; every input/output pair, the batcher's own included, has `ADA_out ≤ ADA_in` | the tx creator sets the fee; a per-size cap set by Midnight bounds drain per deposit, and the pair rule keeps the batcher from gaining ADA while letting it pay the shortfall of a small batch |
| Distribution fee `dist_fee` deducted from a leaf's NIGHT when `amount ≥ min_payout`, left in the batcher's pair | cost recovery alone gave no reason to fold or to batch large; flat per leaf, checked on chain, no exchange rate |
| Digest gains `treasury_total`; the completing batch pays it to the ICS (built 2026-09-27: 125-byte extrinsic, `BatcherState.treasury_total`, ICS output check) | the Treasury share must leave the pool, and the digest has to commit it or a batch could omit the output |
| Reserve release fills the pool to `reserve × (1 − (1 − R)^N)` (factor `num/den`, rounded up), net of the pool balance (built 2026-09-27 in `reserve_logic_v2`) | the geometric placeholder is gone; the ceiling follows the published rate from the live reserve and holds exposure to one interval |
| Interval six hours | per the committee bridge MIP's epoch length |

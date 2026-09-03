# Phase 01 — Virtual accounts: linked list, deposit, registration

Goal: `validators/virtual_account.ak` complete with all user paths; batcher
paths are gates only (validated in phase 04). Spec §2.2, §3, §4.

## Tasks

### 1. `lib/rewards/linked_list.ak`
Hand-ported subset of Anastasia Labs `aiken-design-patterns` linked list
(reference only; do not depend on it). Functions:

```aiken
pub fn deposit_name(skh: ByteArray) -> AssetName        // #"00" ++ skh
pub fn registration_name(skh: ByteArray) -> AssetName   // #"01" ++ skh
pub fn is_list_nft(value, policy) -> Option<AssetName>  // exactly one asset under policy, name "" or 0x00-prefixed
pub fn init_list(inputs, mint, head, tail, own_policy, one_shot_ref) -> Bool
pub fn insert_ascending(anchor: Input, anchor_out, node, own_policy) -> Credential
pub fn unlink(pred: Input, pred_out, own_policy, removed_key, removed_next) -> Bool
```
Rules per spec §4.2. Indexed: the caller hands over the anchor input and
its output, the node output, or the predecessor pair; nothing searches the
transaction. `insert_ascending` reads the anchor kind from its NFT name,
checks `anchor.key < new_key < anchor.next`, the anchor output (same
address, same value, datum with only `next` changed), and the node datum
(`Deposit { cred, next: anchor.next, committed: None }`); value and mint
checks stay in `account.ak`.

### 2. `lib/rewards/account.ak`
Decided 2026-09-03: user logic lives in the withdraw handler (withdraw-zero);
mint and spend are gates. `AccountGate { User | Batcher }` and
`AccountAction` replace the old mint/spend redeemers.
```aiken
pub fn account_gate(withdrawals, own_hash: PolicyId, redeemer: Data) -> Bool
pub fn account_withdraw(tx: Transaction, own_hash: PolicyId, redeemer: Data) -> Bool
```
Every action folds over all own-address inputs, pops outputs from
`offset` 1:1 (no search), and asserts the exact own-policy mint (spec §4.4
table). Node kind from the NFT name. This is what makes account and batcher
withdrawals mutually exclusive without an explicit check.
Withdraw actions (spec §4.4 table): `InitList`, `Register { cred }`,
`Withdraw`, `TopUp`, `SetDeregister(addr)`, `UpdateRegistration`. Continuing
output = the output at the same address carrying the same NFT (find by NFT,
not by index). `SetDeregister` takes the deposit and its registration in
either order, burns the registration NFT, and needs both stake auth and
`owner` auth. `own_hash != config.cnight_policy` once at the top.

### 3. `validators/virtual_account.ak`
`else(ctx)`: `Minting` / `Spending` → `account_gate`; `Withdrawing(Script(h))`
→ `account_withdraw`; `Publishing RegisterCredential` → `True`.

### 4. Tests `validators/virtual_account.test.ak`
Positive and `fail` cases, using phase 00 fixtures:
- init head: ok; without one-shot; wrong asset name.
- register: ok after head; ok between two nodes; ok at tail; wrong order
  (key < anchor, key > next); duplicate key (equal to anchor / next); two
  anchors spent; missing stake sig; script-credential via withdrawal ok;
  deposit below min / above cap; NIGHT in fresh deposit; missing
  registration output; registration NFT name mismatch;
  `dust_address` 34 bytes.
- withdraw: ok; partial NIGHT left; ADA changed; datum changed; no sig.
- top up: ok; below min increment; above cap; NIGHT changed.
- set deregister: ok (either input order); already set; no stake sig; no
  owner sig; value changed; without burn; burn of a different `skh`'s
  registration. (A missing registration input is a ledger failure, not
  tested.)
- registration update: ok; owner rotate ok; NFT dropped; wrong signer;
  moved address; with a burn; on a deposit.
- gates: `User` spend/mint with and without own withdrawal; `Batcher` with
  and without batcher withdrawal; publish `RegisterCredential`.
- mutual exclusion: every action fails next to a batch deposit, head
  predecessor, or batch burn even with both withdrawals present; both
  withdrawals with disjoint inputs pass.
- property test (`aiken/fuzz` is not a dependency; write a small
  deterministic loop): inserting keys in random order yields an ascending
  chain when walked from head.

## Done when
- All tests pass; `just build` regenerates blueprints with
  `virtual_account_hash` written to every profile.

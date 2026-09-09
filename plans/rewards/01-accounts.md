# Phase 01 — Virtual accounts — DONE (commit `8b5acad`)

Delivered: `lib/rewards/linked_list.ak`, `lib/rewards/account.ak`,
`validators/virtual_account.ak`, `validators/virtual_account.test.ak`
(87 tests), `virtual_account_hash` in every profile. Spec §2.2, §3, §4 are
the authoritative description; this page records how it was built and what
phase 04 must honour.

## As built

### `lib/rewards/linked_list.ak`
```aiken
pub fn key(cred: Credential) -> ByteArray                 // 28-byte hash, either constructor
pub fn deposit_name(skh) / registration_name(skh)         // 0x00 ++ skh / 0x01 ++ skh
pub fn init_list(inputs, mint, head: Output, tail: Output, own_policy, one_shot_ref) -> Bool
pub fn insert_ascending(anchor: Input, anchor_out: Output, node: Output, own_policy) -> Credential
pub fn unlink(pred: Input, pred_out: Output, own_policy, removed_key, removed_next) -> Bool
```
Indexed: callers hand over the exact inputs/outputs; nothing searches the
transaction. A node's kind comes from its NFT name (`""` head,
`0x00 ++ skh` deposit) and the datum must agree. Head key is `""`, tail
key is `0xff × 28`; `insert_ascending` requires `anchor.key < new_key < anchor.next`.
`init_list` mints `[("", 1), (0x00 ++ tail_key, 1)]` and checks both node
outputs (`Head { next: tail_key }`, `Tail`).

### `lib/rewards/account.ak`
```aiken
pub fn account_gate(withdrawals, own_hash, redeemer: Data) -> Bool     // User: own withdrawal; else: batcher withdrawal
pub fn account_withdraw(tx, own_hash, redeemer: Data) -> Bool         // AccountAction { kind, offset }
```
One action kind per tx, applied to every input at the account address
(ledger order); outputs from `offset` are consumed 1:1 per own input; the
own-policy mint must be exactly what the action needs (`claim` per NFT,
`unclaimed == []`). `own_hash != config.cnight_policy` once at the top.

| Kind | Per own input | Notes |
|---|---|---|
| `InitList` | none | outputs `[head, tail]` from `offset` |
| `Register` | anchor → `[anchor', node, registration]` | `cred` from the node datum; stake auth; node value = ADA in `[min, cap]` + deposit NFT; registration `is_singleton` + weights valid; one key per anchor input |
| `Withdraw` | deposit → deposit' | stake auth; datum same; NIGHT 0; ADA equal |
| `TopUp` | deposit → deposit' | stake auth; datum same; assets same; `+≥ min`, `≤ cap` |
| `SetDeregister` | deposit → deposit' (`committed: Some(_)`, any addr); registration → nothing | stake auth on the deposit, owner auth on the registration; registration NFT burned; inputs in any order |
| `UpdateRegistration` | registration → registration' | owner auth on the input; same address; `is_singleton`; weights valid |

### `validators/virtual_account.ak`
`Minting` / `Spending` → `account_gate`; `Withdrawing(Script(h))` →
`account_withdraw`; `Publishing RegisterCredential` → `True`.

### Tests (`validators/virtual_account.test.ak`, 88)
Init list; register (head anchor, middle, tail, order violations,
duplicates, two anchors, auth variants, ADA bounds, NIGHT present,
registration missing / wrong NFT / weight errors); withdraw; top up; set
deregister (either order, already set, auth, value change, no burn, wrong
registration); update registration (owner rotate, NFT dropped, moved,
with burn, on a deposit); gates; mutual exclusion with batcher inputs;
`register_random_order_yields_sorted_chain`: 12 blake2b-224 keys inserted
in hash order through the validator against an off-chain model, walked
from the head; chain equals the sorted keys.

Run the module with `aiken check -m 'virtual_account.{..}'`; `aiken` prints
diagnostics only on a TTY, a piped run exits 1 silently.

## Contract with phase 04 (batcher side)
- Deposit spends and the deposit-NFT burn use gate redeemer `Batcher`; the
  batcher withdraw must validate every input carrying an `account_policy`
  token (paid deposits + exit predecessors), count-checked (spec §5.3).
- Head may be spent only as an exit predecessor; the tail is never an
  input; `unlink(pred, pred_out, policy, removed_key, removed_next)` is the
  relink primitive.
- Deposit datum `next` is a plain key (`tail_key` at the end); an exit sets
  the predecessor's `next` to the removed node's `next`.
- Reuse `value.ak` (`split_ada`, `only_nft`, `tokens_of`) and
  `fold.foldl2` for the per-pair checks.

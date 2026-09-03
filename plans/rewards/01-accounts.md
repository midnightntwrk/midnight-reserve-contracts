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
pub fn init_head(inputs, mint, outputs, own_policy, one_shot_ref) -> Bool
pub fn insert_ascending(inputs, outputs, mint, own_policy, new_key) -> Output   // returns the new node output
pub fn unlink(inputs, outputs, own_policy, removed_key, removed_next) -> Bool
```
Rules per spec §4.2. `insert_ascending` finds exactly one input carrying a
head or deposit NFT (fail on zero or two), checks `anchor.key < new_key`
(head: skip), `anchor.next == None || new_key < next`, finds the anchor
output (same address, same value, datum with only `next` changed), and the
node output (own address, `Deposit { key: new_key, next: anchor.next, committed: None }`,
value = ADA + NFT only). Mint must be exactly `[(deposit_name, 1), (registration_name, 1)]`
under own policy (checked by the caller in `account.ak`, not here).

### 2. `lib/rewards/account.ak`
```aiken
pub fn account_mint(tx: Transaction, own_policy: PolicyId, redeemer: Data) -> Bool
pub fn account_spend(tx: Transaction, own_hash: ScriptHash, datum: Data, redeemer: Data, own_ref: OutputReference) -> Bool
```
Mint:
- `InitHead` → `init_head` with `config.virtual_account_one_shot_*`.
- `Register { cred }` → spec §4.3 (`skh = key(cred)`; `stake_auth(cred)`;
  insert; new deposit datum `cred == redeemer cred`; deposit ADA in
  `[deposit_min_lovelace, deposit_cap_lovelace]`, NIGHT 0; exactly one
  registration output with matching `stake_key_hash`, `dust_address ≤ 33`).
  Helper `key(cred: Credential) -> ByteArray` in `linked_list.ak`.
- `BurnDeposit` → mint is exactly `[(deposit_name(k), -1)]` for one `k` and a
  withdrawal from `config.rewards_batcher_hash` exists.
- `BurnRegistration` → mint is exactly `[(registration_name(k), -1)]`; the
  spent registration input with that NFT exists (owner auth is in the
  spend) and a deposit input with `deposit_name(k)` is spent with redeemer
  `SetDeregister` (the deposit spend checks the flag flip; this mint branch
  checks the pairing so neither can happen alone).
- `own_policy != config.cnight_policy`.

Spend (dispatch on datum constructor, then redeemer):
- `HeadDatum`: `AnchorInsert` (positive mint under own policy exists) or
  `BatcherPay` (batcher withdrawal exists; unlink of first node).
- `DepositDatum`: table in spec §4.4. Continuing output = the output at the
  same address carrying the same NFT (find by NFT, not by index).
- `RegistrationDatum`: `UpdateRegistration` (owner auth, NFT continues) /
  `Deregister` (owner auth; burn of own NFT in `mint`; the paired deposit
  spend is verified by the mint branch) per §3.
- `DepositDatum` + `SetDeregister(addr)`: stake auth, `committed` flips
  `None → Some(addr)`, and `mint` contains `(registration_name(key), -1)`.

Value predicates: `deposit_value_ok(value, policy, skh)` — exactly ADA,
the NFT, and optionally NIGHT; `registration_value_ok` — exactly ADA + NFT.

### 3. `validators/virtual_account.ak`
```aiken
validator virtual_account {
  else(ctx: ScriptContext) { when ctx.info is { Minting(p) -> account_mint(..) ; Spending{datum, output} -> account_spend(..) ; _ -> fail } }
}
```

### 4. Tests `validators/virtual_account.test.ak`
Positive and `fail` cases, using phase 00 fixtures:
- init head: ok; without one-shot; wrong asset name.
- register: ok after head; ok between two nodes; ok at tail; wrong order
  (key < anchor, key > next); duplicate key (equal to anchor / next); two
  anchors spent; missing stake sig; script-credential via withdrawal ok;
  deposit below min / above cap; NIGHT in fresh deposit; missing
  registration output; registration `stake_key_hash` mismatch;
  `dust_address` 34 bytes.
- withdraw: ok; partial NIGHT left; ADA changed; datum changed; no sig.
- top up: ok; below min increment; above cap; NIGHT changed.
- set deregister: ok (deposit flag + registration burn + owner sig +
  stake sig); already set; no stake sig; no owner sig; registration burn
  without deposit flag; deposit flag without registration burn; burn of a
  different `skh`'s registration.
- registration update: ok; owner rotate ok; `stake_key_hash` changed;
  NFT dropped; wrong signer. No standalone delete path exists: a spend
  with a burn but no `SetDeregister` deposit input fails.
- gates: `AnchorInsert` without mint; `BatcherPay` without batcher
  withdrawal.
- property test (`aiken/fuzz` is not a dependency; write a small
  deterministic loop): inserting keys in random order yields an ascending
  chain when walked from head.

## Done when
- All tests pass; `just build` regenerates blueprints with
  `virtual_account_hash` written to every profile.

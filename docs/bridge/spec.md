# Committee Bridge — Contract Specification

Status: Draft. Normative source is the
[Committee Bridge Consensus MIP](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/262)
("MIP"). This page does not restate MIP rules; it cites them by number and
adds what the contracts need: types, `Data` layouts, hash dependencies,
config keys, cost targets, and the decisions this repo makes where the MIP
leaves a choice (§14, §15). Overview: [overview.md](overview.md).

Conventions: Aiken v1.1.21, Plutus V3, stdlib v2.2.0 (repo pins). The bridge
files (`lib/bridge/*`, `validators/committee_bridge.ak`, the
`beefy_signer_threshold` validator in `validators/thresholds.ak`) are
edited in place; see CLAUDE.md. Byte sizes are exact.

---

## 1. Components and hash dependencies

```
beefy_signer_threshold  (fixed; config.committee_threshold_one_shot_*)
      ^ reference input
      |
committee_bridge_{forever, two_stage_upgrade, logic}
      ^ input carrying the forever NFT
      |
committee_bridge_pool   (fixed; depends on config.committee_bridge_two_stage_hash)
```

| File | Validator | Purposes |
|---|---|---|
| `validators/committee_bridge.ak` | `committee_bridge_forever` | mint (bootstrap), spend (gate: logic + mitigation logic withdrawals) |
| `validators/committee_bridge.ak` | `committee_bridge_two_stage_upgrade` | mint, spend (stage / promote under `gov_auth`) |
| `validators/committee_bridge.ak` | `committee_bridge_logic` | withdraw (the update, rules 0–10 and 12–17), publish |
| `validators/thresholds.ak` | `beefy_signer_threshold` | mint, spend (`threshold_validation` under Council + Tech Auth) |
| `validators/committee_bridge_pool.ak` | `committee_bridge_pool` | spend (gate: the running logic, read from the two-stage `main` datum, withdraws in the same tx) |

| File | Content |
|---|---|
| `lib/bridge/types.ak` | every datum and redeemer below |
| `lib/bridge/codec.ak` | SCALE encoders: 48-byte commitment, 82-byte leaf |
| `lib/bridge/merkle.ak` | five-shape multiproof walker (leaves in tree order), single-leaf MMR verify by index and count |
| `lib/bridge/beefy.ak` | `verify_update`: rules 1–10, next state; `required` |
| `lib/bridge/pool.ak` | `check_pool`: rules 12–17 |
| `lib/bridge/test_fixtures.ak` | test-only builders: keys, commitments, MMRs, multiproofs (phase 01) |

Config keys (all 8 profiles: `default`, `local`, `preview`, `qanet`,
`govnet`, `devnet`, `preprod`, `mainnet`):
`committee_bridge_one_shot_{hash,index}`, `committee_bridge_two_stage_hash`,
`committee_bridge_forever_hash`, `committee_threshold_one_shot_{hash,index}`,
`beefy_signer_threshold_hash` (existing);
`committee_bridge_pool_hash` (new, phase 03).

---

## 2. Notation

MIP §Notation is authoritative: `Keccak-256`, `SCALE`, *key* (33 bytes),
*signature* (64 bytes `r ‖ s`, low-S), *seat*, `merkle_root`, *multiproof*,
*MMR proof*, `required(seat_count, n, d)`.

`required` in Aiken:

```aiken
pub fn required(seat_count: Int, numerator: Int, denominator: Int) -> Int {
  seat_count - ( seat_count - 1 ) * ( denominator - numerator ) / denominator
}
```
`(2, 3)`: 10 → 7, 6 → 5, 3 → 3, 1 → 1 (MIP §Test vectors). The current
`ceil(len × n / d)` is one seat short when `len` is a multiple of three.

---

## 3. Types (`lib/bridge/types.ak`)

Every constructor has index 0; integers are `Int`, byte strings `ByteArray`.
Field order is the `Data` order (MIP §Cardano-side verification, §Light-client
state).

```aiken
pub type AuthoritySetCommitment {      // MIP "commitment", 44 SCALE bytes
  validator_set_id: Int,               // u64
  seat_count: Int,                     // u32, total seats with repetition
  keyset_commitment: ByteArray,        // 32
}

pub type BeefyMmrLeaf {                // MIP §MMR leaf, 82 SCALE bytes
  version: Int,                        // u8, 0x00
  parent_number: Int,                  // u32
  parent_hash: ByteArray,              // 32
  next_authority_set: AuthoritySetCommitment,
  extra: ByteArray,                    // empty
}

pub type BeefyConsensusState {         // light-client datum
  latest_mmr_root: ByteArray,          // 32
  latest_height: Int,                  // u32
  beefy_activation_block: Int,         // u32, carried unchanged
  current_committee: AuthoritySetCommitment,
  next_committee: AuthoritySetCommitment,
}

pub type BeefyThreshold {              // threshold UTxO datum
  numerator: Int,
  denominator: Int,
  base: Int,                           // lovelace, max_fee.base
  per_signer: Int,                     // lovelace, max_fee.per_signer
}

pub type BridgeUpdate {                // committee_bridge_logic redeemer
  mmr_root: ByteArray,                 // 32, the signed root
  block_number: Int,
  validator_set_id: Int,
  signatures: List<ByteArray>,         // one per multiproof leaf, tree order; 64 bytes, or empty for a non-signer
  leaf: BeefyMmrLeaf,                  // the leaf of block_number
  mmr_proof: List<ByteArray>,          // LeafProof.items
  multiproof: Data,                    // five-shape tree, signers' leaves
}

pub type Leaf = ByteArray              // 37 bytes: key (33) ‖ seats (u32 LE)
```

Removed from today's code: `Vote`, `Payload`, `SignedCommitment`,
`RelayChainProof`, `BeefyConsensusProof`, `mmr_root_payload_id`.
`AuthoritySetCommitment.{id, len}` are renamed to the MIP names; the
`Data` shape is unchanged.

---

## 4. Encodings (`lib/bridge/codec.ak`)

| Bytes | Layout | Used for |
|---|---|---|
| Signed commitment, 48 | `04 ‖ "mh" ‖ 80 ‖ mmr_root(32) ‖ block_number(u32 LE) ‖ validator_set_id(u64 LE)` | `Keccak-256` of it is the signed hash (rule 5) |
| MMR leaf, 82 | `version(1) ‖ parent_number(u32 LE) ‖ parent_hash(32) ‖ validator_set_id(u64 LE) ‖ seat_count(u32 LE) ‖ keyset_commitment(32) ‖ 00` | `Keccak-256` of it is the MMR leaf hash (rule 8) |
| Authority leaf, 37 | `key(33) ‖ seats(u32 LE)` | multiproof leaves; `Keccak-256(leaf)` is level 0 |

The 32-byte width guards on `parent_hash` and `keyset_commitment` stay: the
encoding is injective only because of them (see the malleability tests in
`codec.ak`). `extra` is asserted empty, not passed through.

Multiproof: MIP §Notation *multiproof*, exactly the five node shapes
`lib/bridge/merkle.ak` walks today. Leaves are returned in tree order; since
leaves are sorted by key, tree order is key order (not checked on chain, §15).

MMR proof: `LeafProof.items` from `pallet-mmr`, verified as `mmr-lib` 0.8.2
`calculate_root` for a single leaf: one item per peak left of the leaf's
peak, then the path siblings by leaf-index bits, then one bagged item for
the right peaks (`gen_proof` walks the peaks left to right). Index and count
are computed, not supplied: index `block_number − 1`, count `block_number`.
The same walk exists as `lib/rewards/mmr.ak` `verify_leaf` on the rewards
branch; phase 01 ports it into `lib/bridge/merkle.ak` and the rewards code
imports it from there after merge.

---

## 5. Light-client update (`committee_bridge_logic`, MIP rules 0–10)

Trigger: `Withdrawing` of the logic credential only. The audited
validators also run their logic on `Publishing UnregisterCredential`; they
are permissioned, the bridge is not, so that arm would let anyone with a
valid update deregister the credential and block later updates until it is
registered again. `Publishing RegisterCredential` is always allowed. Inputs the
logic reads:

- `state_in`: inline datum of the input whose value is exactly the forever
  NFT (`get_input_state_by_policy(inputs, config.committee_bridge_forever_hash)`).
- `state_out`: inline datum of output 0, which must sit at the forever
  credential with value = ADA + NFT.
- `threshold`: `BeefyThreshold` from the reference input carrying
  `config.beefy_signer_threshold_hash`.
- `update: BridgeUpdate` = redeemer.

| MIP rule | Check | Where |
|---|---|---|
| 0 | output 0 is at the forever credential, value is ADA + NFT only, `lovelace(out) ≥ lovelace(in)`, datum = computed state | `committee_bridge_logic` |
| 1 | `block_number > latest_height` | `verify_update` |
| 2 | `validator_set_id ∈ {current.validator_set_id, next.validator_set_id}` → `S` | `verify_update` |
| 3 | multiproof root = `S.keyset_commitment` | `merkle.verify_multiproof` |
| 4 | leaves strictly increasing by key | not enforced, see §15 |
| 5 | `length(signatures) = length(leaves)`; `sig_i = ""` skips leaf `i`, else `verify_ecdsa_secp256k1_signature(key_i, keccak(commitment), sig_i)` | `sum_signed_seats` |
| 6 | `Σ seats ≥ required(S.seat_count, numerator, denominator)` | `verify_update` |
| 7 | `leaf.parent_number = block_number − 1` | `verify_update` |
| 8 | MMR proof of `keccak(SCALE(leaf))` at index `block_number − 1`, count `block_number`, against `mmr_root` | `merkle.verify_mmr_leaf` (index walk) |
| 9 | `leaf.next.validator_set_id ∈ {next.validator_set_id, next.validator_set_id + 1}` | `verify_update` |
| 10 | not (`validator_set_id = next.validator_set_id` and `leaf.next.validator_set_id ≠ next.validator_set_id + 1`) | `verify_update` |

Next state: `latest_mmr_root ← mmr_root`, `latest_height ← block_number`;
handover iff `leaf.next.validator_set_id = next.validator_set_id + 1`, then
`current ← next`, `next ← leaf.next`. `beefy_activation_block` unchanged.
`state_out` must equal it.

Bootstrap (`committee_bridge_forever` mint): `input_linked_mint` plus
`next.validator_set_id = current.validator_set_id + 1`,
`latest_height = beefy_activation_block − 1`, both `seat_count > 0`,
`latest_mmr_root` and both `keyset_commitment` 32 bytes. Every
value is recomputable from Midnight state at `beefy_activation_block`
(MIP §Bootstrap).

---

## 6. Threshold UTxO and `max_fee` (`beefy_signer_threshold`)

Datum `BeefyThreshold` (§3). `beefy_validation`: `0 ≤ numerator < denominator`,
`base ≥ 0`, `per_signer ≥ 0`. Spend rules unchanged: `threshold_validation`
(Council + Tech Auth multisig per `main_gov_threshold`, same NFT out, new
datum validated). Initial value `(2, 3, base, per_signer)` with both fee
amounts measured before deployment (MIP §Why a fee cap calculated in
advance). An update never touches this UTxO, so `max_fee` cannot be raised
by a submitter (MIP: "`max_fee` unchanged by an update" holds by
construction).

---

## 7. Funding pool (`committee_bridge_pool`, MIP rules 12–17)

Pool script: spend-only. Rule: the running logic credential, read from the
two-stage `main` reference input (`config.committee_bridge_two_stage_hash`)
exactly as the forever spend reads it, is among the withdrawals. Nothing
else. A withdrawal list is one or two entries, an input scan is not. The
logic run then requires the forever NFT in and out and enforces the pool
rules below whenever any input sits at the pool credential. No datum,
no NFT, any number of pool UTxOs; a top-up is a plain payment to the pool
address.

Inside `committee_bridge_logic`, with `pool_in = Σ lovelace` of inputs at
`Script(config.committee_bridge_pool_hash)` (any stake part, so a stray
top-up with one can still be swept) and `pool_out` the same over outputs, `debit = pool_in − pool_out`, `s = length(leaves)`,
`cap = base + per_signer × s`:

| MIP rule | Check |
|---|---|
| 12 | output 1 is at the pool address (`Script(pool)`, no stake part, so a submitter cannot redirect delegation rewards); its value is lovelace only; no datum required. Later outputs are not read: a further pool output is not subtracted, so it only raises the debit |
| 13 | if `debit ≤ 0`: done (merge or top-up inside an update) |
| 14 | the light-client update in this tx is valid (it is: same script run) |
| 15 | the update is a handover: `state_in.next.validator_set_id ≠ state_out.next.validator_set_id` |
| 16 | `debit ≤ transaction.fee` |
| 17 | `debit ≤ cap` |

If no input is at the pool credential, none of this runs and the submitter
pays the fee (bootstrap's activation-block justification, voluntary
non-handover updates).

---

## 8. Governance and upgrade

`committee_bridge_forever` / `committee_bridge_two_stage_upgrade` are the
shared pattern ([../governance/upgrade.md](../governance/upgrade.md)):
spend of the state NFT requires `logic` and `mitigation_logic` withdrawals
from the two-stage "main" datum; stage and promote require `gov_auth`
(Council + Tech Auth) under `main_gov_threshold` / `staging_gov_threshold`.
The MIP's "governance ... re-registers the committee commitments if the
induction ever breaks" is a logic upgrade to a one-off migration script
that writes a new datum, then an upgrade back. The threshold UTxO is not
part of the upgrade path.

---

## 9. Transactions

| Tx | Inputs | Reference inputs | Outputs | Withdrawals / mints |
|---|---|---|---|---|
| Deploy | one-shots | — | forever NFT + bootstrap datum; two-stage main + staging; threshold NFT + `(2, 3, base, per_signer)` | mints |
| Update (unfunded) | light client, submitter ADA | two-stage main, threshold | light client (same NFT, ADA ≥ in, new datum) | logic + mitigation logic |
| Handover (funded) | light client, ≥1 pool UTxO | two-stage main, threshold | light client; exactly one pool output | logic + mitigation logic |
| Top-up | funder ADA | — | pool | — |
| Consumer read | consumer's own | light client | consumer's own | consumer's own |
| Threshold edit | threshold NFT | `main_gov_threshold`, council + tech auth forever | threshold NFT + new datum | council + tech auth witness mints |

An update spends the light client, so a consumer transaction built against
the replaced datum fails phase-1 validation at no cost (MIP §Light-client
state).

---

## 10. Invariants (test targets)

- One rejection per MIP rule 0–10 and 12–17; an accept with every rule at
  its boundary (`block_number = latest_height + 1`, seats = `required`,
  `debit = cap = fee`).
- MIP §Test vectors, all of them: commitment root with seats `(1, 2, 1)`
  and the same root from `[k2, k1, k2, k3]`; the 48 signed bytes; the 82
  leaf bytes; quorum table; height boundary; three-peak MMR item order
  (`[P1, siblings…, R]`, as `mmr-lib` `gen_proof` emits: left peaks first);
  MMR edges (`block_number = 1`, leaf that is a peak); bootstrap; handover
  table (`4/5`: leaf `5` by `4` no handover; leaf `6` by `5` handover; leaf
  `5` by `5` rejected; leaf `7` rejected).
- Multiproof with a non-signer leaf and `""` signature: seats skipped.
- Signature list shorter than the leaves: rejected by rule 5 length check.
- Signatures out of tree order: rejected by rule 5.
- High-S signature: rejected by the builtin.
- `max_fee` and the threshold unchanged by any update (no path touches them).
- Pool: merge of several pool inputs into one output; top-up inside an
  update; second pool output rejected; token in pool output rejected;
  funded non-handover rejected; `debit > fee` rejected; `debit > cap`
  rejected.
- Bootstrap datum recomputed from the private network equals the deployed
  one (phase 07).

---

## 11. Costs and `signer_cap`

`signer_cap` is the largest committee of distinct single-seat members whose
`required`-quorum update fits one transaction in size and budget. Phase 04
measures it with a test-only builder at N = 50, 100, 150, 200 and records
here: tx size, mem, cpu, and the largest passing N. MIP estimate: ~10 KB at
100 keys / 67 signers against `maxTxSize` 16,384. Size drivers per signer:
64 (signature) + 37 (leaf) + CBOR framing; per non-signer subtree: 32.

| N | signers | tx bytes | mem | cpu | fits |
|---|---|---|---|---|---|
| TBD | | | | | |

---

## 12. Requirements on the node

See [overview.md §What the node must emit](overview.md#what-the-node-must-emit-mip-driven).
The relay's proof builder (`midnight-beefy-relay`) must emit `BridgeUpdate`
in §3 order with signatures in leaf order (`""` for a non-signer leaf); a
signers-only multiproof is the smallest.

---

## 13. Consumer contract

Reference the light-client UTxO by `config.committee_bridge_forever_hash`
singleton NFT; read `latest_mmr_root` and `latest_height`. The root in
block `b`'s digest has `b` leaves; the signed root at `latest_height` has
`latest_height` leaves, and leaf `i` commits block `i + 1`'s parent. A
consumer proves leaf index `i < latest_height` with the same
index-and-count MMR walk as rule 8.

---

## 14. Decisions log (interview 2026-09-23)

- **Docs drive code.** MIP is normative; this page cites rules by number.
  Deviations allowed when safety is preserved and the contract is cheaper.
- **Loose docs.** `spec/` → `docs/governance/`; CLI docs folded into the
  README; root strays and swarm specs deleted.
- **Base.** Work lands on top of `beefy-validate-block-rewards`; rewards
  docs stay on their branch and link here after merge.
- **Audit.** Bridge files edited in place; re-audit follows the alignment.
  CLAUDE.md records the exception.
- **Upgrade wrapper kept.** Forever/Two-Stage/Logic, as every contract here.
- **`max_fee` in the threshold datum**, not the light-client datum.
- **Redeemer = MIP flat layout.** `Vote.public_key` dropped: the key comes
  from the multiproof leaf anyway, and the leaf bytes must be present as the
  Keccak preimage; carrying the key twice costs 33 bytes per signer for no
  check. Alternative (leaves in the vote list, hash-only tree) saves ~2 B
  per signer of framing and forks the MIP layout; revisit only if phase 04
  lands within 200 B of `maxTxSize` at the target committee.
- **Pool: fixed script, no NFT, no datum, any UTxO count.** Rules 12–17 run
  inside the bridge logic. Catch-up after a stall is a sequence of
  handovers (every pumped item is a session's mandatory justification,
  which always names the next set), so strict rule 15 is sufficient.
- **Open items left open:** collateral without a wallet; misbehavior
  response.
- **`signer_cap`:** measure, no target.
- **Vectors:** TS reference implementation (`@noble/curves`, `@noble/hashes`)
  emits JSON; Aiken fixtures mirror; values ported to the MIP.
- **Private network:** compact-end-2-end infra with `midnight-node` built
  from `lglo/beefy-on-main`; moth-wallet has no node build path.

---

## 15. Deviations from MIP text

| MIP | Here | Safety argument |
|---|---|---|
| `max_fee` in the light-client datum | in `BeefyThreshold` | still governance-only; an update cannot touch the threshold UTxO at all |
| "the light client itself has the one redeemer" | logic script with one redeemer behind the forever/two-stage wrapper | script replacement needs Council + Tech Auth; consumers keep one NFT to follow |
| pool rules stated on the pool spend | enforced by the bridge logic; pool spend = forever NFT is an input | pool cannot be spent without a valid update running |
| rule 12: exactly one output at the pool address | output 1 is the pool output, lovelace only; later outputs unread | positional, no output scan; an extra pool output is unsubtracted debit, so never a drain |
| bootstrap prose | `next = current + 1`, `latest_height = activation − 1`, both `seat_count > 0`, 32-byte roots checked at mint | tighter than `next.id > current.id` today; `required(0, n, d) = 0` would accept unsigned updates |
| MMR proof "verified as `calculate_root` does" | index-walk form (equal results, flat cost) | proven equal on all leaves of sizes 1..24 and golden vectors on the rewards branch |
| rule 4: leaves in strictly increasing key order | not checked | the multiproof root binds every leaf to the committed tree, so order adds nothing to the bridge; key order matters only to the rewards range proofs, which check it themselves |
| rule 5: one signature per leaf | an empty signature marks a non-signer leaf, seats not counted | a leaf adds seats only with a valid signature; the relay may include non-signers at 1 byte each |

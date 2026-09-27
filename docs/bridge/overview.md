# BEEFY Committee Bridge on Cardano — Overview

Status: Draft (design settled in interview 2026-09-23; `signer_cap` pending
measurement, node-side changes pending the node team). Normative source:
[MIP-xxxx Committee Bridge Consensus Integration](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/262)
("the MIP"). Contract spec: [spec.md](spec.md). Implementation plan:
[`plans/bridge/`](../../plans/bridge/00-index.md).

## What

A light client on Cardano tracks the Midnight BEEFY committee by induction:
each committee vouches for its successor. Committee-signed MMR roots let any
Cardano contract verify Merkle inclusion of any Midnight block, with no proof
system in the loop. Three on-chain pieces:

| Piece | Role | Upgradable |
|---|---|---|
| **Light client** (`committee_bridge_*`) | One NFT-identified UTxO whose datum is the whole bridge state: latest signed MMR root and height, current and next committee commitments, activation block. Spent only by an *update* carrying a quorum-signed commitment. | Yes (Forever → Two-Stage → Logic) |
| **Threshold UTxO** (`beefy_signer_threshold`) | Governance parameters read by reference: quorum ratio `(numerator, denominator)` and the fee cap `max_fee = (base, per_signer)`. | No (governance-edited under Council + Tech Auth) |
| **Funding pool** (`committee_bridge_pool`) | ADA at a script address. Pays the fee of one handover update per session, under the cap. Anyone tops it up; block producers are the expected funders. | No (fixed) |

Consumers (first: the rewards batcher) never spend the light client. They read
its datum as a reference input and verify a Keccak-256 MMR inclusion proof
against `latest_mmr_root` themselves.

## Why this shape

- **Induction, not registration.** Committee N+1 can sign only after a root
  signed by committee N proved a leaf that names N+1. Governance registers
  the base case once; every later committee reaches Cardano by handover.
- **Deduplicated commitment.** Ariadne seats repeat keys. One Merkle leaf per
  distinct key, `key ‖ seats`, sorted by key bytes. `seat_count` (with
  repetition) is the quorum denominator. Bounds the update by distinct
  signers, not seats.
- **Signers ride in the multiproof.** The redeemer carries one signature per
  multiproof leaf, in tree order; the key is sliced from the leaf. No key
  bytes in the vote list, no on-chain lookup.
- **Quorum = BEEFY's.** `required(seat_count, n, d) = seat_count − ⌊(seat_count − 1)(d − n)/d⌋`;
  at 2/3 it is the `sc-consensus-beefy` threshold.
- **Root-only payload.** Validators sign `{ mmr_root, block_number, validator_set_id }`,
  48 SCALE bytes. Everything else is proven from the root.
- **Fee from a pool, not a wallet.** The node's data pump submits updates;
  no node holds a fee-paying key. The pool pays one handover per session,
  at most `base + per_signer × signers`. A padded fee is bounded; extra
  submissions are unpaid.
- **Governance stays outside the hot path.** The light client has one
  redeemer. Fee cap and quorum ratio live in the threshold UTxO, edited under
  Council + Tech Auth. Script replacement uses the repo's two-stage upgrade;
  the MIP defers to it.

## Actors

- **Data pump** (in every consensus node): builds and submits the mandatory
  justification of each session as an update; pays from the pool. Node-side,
  out of this repo's scope; the MIP §Data pump specifies it.
- **Governance** (Council + Tech Auth multisig via `gov_auth`): deploys the
  light client with the bootstrap datum, edits the threshold UTxO, runs the
  two-stage upgrade, re-registers commitments if the induction breaks.
- **Funder**: pays ADA to the pool address. No script runs.
- **Consumer contract**: reads the light client by reference and proves a
  past block against `latest_mmr_root`.

## Flows

1. **Bootstrap.** Governance mints the light-client NFT with
   `current_committee = c`, `next_committee = c + 1`,
   `latest_height = beefy_activation_block − 1`, `latest_mmr_root` = digest
   root of that block. Every field is recomputable from public Midnight state.
2. **Update.** An update spends the light client, proves a quorum of the
   current or next committee over the signed root, proves the leaf of
   `block_number` in that root, and writes the new root and height.
3. **Handover.** When the proven leaf names `next + 1`, `current ← next`,
   `next ← leaf.next`. The pool may pay for this update only.
4. **Top-up.** Pay ADA to the pool address.
5. **Consumer read.** Reference the light client; verify an MMR proof of
   any leaf index `< latest_height` against `latest_mmr_root` with
   `latest_height` leaves.

## What the node must emit (MIP-driven)

| Requirement | MIP section | Node (2026-09-27) |
|---|---|---|
| `key ‖ seats (u32 LE)` leaves, deduplicated, sorted; `len` = total seats | Committee commitment | done on `kc-beefy-mip-alignment`; `lglo/beefy-on-main`: 33-byte key leaves, one per seat |
| BEEFY payload = MMR root only (`mh`) | Signed commitments | done on `kc-beefy-mip-alignment`; five entries on `lglo/beefy-on-main` |
| Leaf of a session's first block names the next set (Session hooks before Mmr) | rule 10 | done on `kc-beefy-mip-alignment`; `lglo/beefy-on-main` and `main` name the current set |
| 64-byte low-S signatures (recovery byte dropped by the submitter) | Notation | 65-byte recoverable, low-S |
| `beef` session key, no cross-chain fallback | Keys | fallback on `lglo/beefy-on-main` |
| `update_d_parameter` rejects seat totals above `signer_cap` | Committee size, rule 11 | absent |
| Data pump: light-client module, oldest session first, funded by the pool | Data pump | relay logs proofs (over the seat leaves on `kc-beefy-mip-alignment`), no submission |
| Six-hour epoch | Epoch length | 30 minutes |

`kc-beefy-mip-alignment` is four local commits on `lglo/beefy-on-main`, for a
PR to that branch; a local dev node against the base confirmed each "done" row.

Phase 07 soak (2026-09-27): the node repo's `local-environment` `local-env`
stack (local Cardano devnet, db-sync, six nodes built from
`kc-beefy-mip-alignment`, nothing mocked), sessions of 30 s (`slotsPerEpoch`
5, set by its setup), D-parameter (5, 0) over five permissioned candidates.
A preview light client bootstrapped from it at block 560 (sets 112 and 113)
took 28 funded handovers from real justifications (sets 113 to 140). A
`change-federated-ops` transaction on the devnet removed one candidate: set 137
has four keys, one of them with two seats, and the bridge handed over to it
and accepted its signatures. An earlier light client on the same stack took
27 handovers across the same change. What the node emitted, against the MIP:
- Justifications carry one 65-byte recoverable signature per seat (a key with
  two seats signs twice, the same bytes); `bridge-fetch-justification` sums the
  seats per key and drops the recovery byte.
- Most sessions' justifications held 4 of 5 seats, so the update reveals only
  the signers' leaves; in the earlier run all five seats signed set 33, and
  the update kept a minimal cover of four (the 2-seat key and two others).
- The leaf of block `b` is index `b − 1` of `b` in `mmr_generateProof`, and
  the leaf of a session's first block names the next set.
- The local-env stack of `lglo/beefy-on-main` does not run as checked in:
  the contract-compiler image pins `libssl-dev=3.0.20-1~deb12u2`, which no
  longer installs, and postgres allows 120 connections while six nodes open
  up to 37 each, so authoring stalls on `PoolTimedOut`. Two commits on
  `kc-beefy-mip-alignment` fix both; `just private-net-up` runs the stack.

`signer_cap` measured in this repo (plan phase 04, spec §11): a quorum
update crosses `maxTxSize` at N ≈ 170; candidate **160** for the node team
(relay submits at most `required` signers), with `max_fee` candidates
`base = 650_000`, `per_signer = 13_000` lovelace.

## Decisions that refine the MIP text

The MIP governs where it is explicit. Where it leaves a choice to "the Aiken
contract", or where the repo pattern is safer or cheaper, this repo decides:

| Topic | MIP text | Here | Why |
|---|---|---|---|
| Where `max_fee` lives | in the light-client datum, or beside the threshold (open) | in the threshold UTxO datum | governance edits it without an upgrade; one reference input |
| Governance path | "the light client itself has the one redeemer"; two-stage upgrade not enforced | Forever/Two-Stage/Logic wrapper as every other contract | proven pattern; the update redeemer is still the only logic redeemer |
| Pool rules 12–17 | rules on "a transaction that spends the pool" | enforced inside `committee_bridge_logic`; the pool script only requires the light client to be spent in the same tx | the logic already holds `s`, the cap and the handover flag; no second decoder |
| Pool outputs | exactly one output at the pool address | plus: lovelace only, no datum | no token dust griefing |
| Bootstrap datum | `next = c + 1`, `latest_height = activation − 1` (prose) | checked at mint | recomputable, cheap |

Open (node-side or future MIP, not decided here): collateral without a
wallet; on-chain misbehavior response.

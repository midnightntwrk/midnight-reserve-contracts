# Rewards implementation plan — index

Spec: [`docs/rewards/spec.md`](../../docs/rewards/spec.md). Each phase ends
with `just fmt && just build && just check && bun test` green and a `jj`
commit. No audited file is touched. No TypeScript until phase 06.

| Phase | File | Delivers | Depends on |
|---|---|---|---|
| 00 ✅ | [00-foundations.md](00-foundations.md) | `lib/rewards/{types,auth,value,fold,test_fixtures}.ak`, config keys in 8 profiles, `NetworkConfig` keys | — |
| 01 ✅ | [01-accounts.md](01-accounts.md) | `lib/rewards/linked_list.ak`, `lib/rewards/account.ak`, `validators/virtual_account.ak` + 87 tests, `virtual_account_hash` | 00 |
| 02 ✅ | [02-merkle-range.md](02-merkle-range.md) | `lib/rewards/merkle_range.ak`, `lib/rewards/merkle_range_builder.ak` (test-only) + 34 tests | 00 |
| 03 ✅ | [03-digest-proof.md](03-digest-proof.md) | `lib/rewards/{scale,trie,digest}.ak`: compact codec, header parse, `extrinsics_root` trie proof, digest extrinsic decode + tests; the MMR walk is the MIP bridge's `merkle.verify_mmr_leaf` | 00 |
| 04 ✅ | [04-pool-batcher.md](04-pool-batcher.md) | `validators/rewards_batcher.ak`, `validators/rewards_pool.ak`, `validators/staging_rewards_pool.ak`, `lib/rewards/{batch,pool}.ak` + 115 tests, batcher and pool hashes in the default profile | 01, 02, 03 |
| 05 ✅ | [05-reserve-release.md](05-reserve-release.md) | `lib/rewards/release.ak`, `reserve_logic_v2` with `Release` to the pool ceiling + 22 tests | 04 (pool hash) |
| MIP (demo path) ✅ | — | 125-byte digest with `treasury_total` paid to the ICS by the completing batch; `payout_threshold` in the registration. The fee schedule (skim cap, `dist_fee`) stays open (spec §4.6) | 03, 04 |
| 06 | [06-typescript.md](06-typescript.md) | CLI commands, prover, reference batcher, emulator e2e | 01–05 |

Phases 01, 02, 03 are independent and can run in parallel after 00.

## Open items that gate "done"

| Item | Owner | Blocks |
|---|---|---|
| Emission formula + per-network numbers | Jon / tokenomics | 05 final values (code uses config placeholders; interval = one Midnight epoch) |
| Node-team confirmation of `docs/rewards/node-team-brief.md` (payload layout, epoch counter, tree builder, even-block vector) | node team | 03 vectors only; layout is pinned on our side |
| Bridge re-audit after the MIP alignment (its `merkle.verify_mmr_leaf` is the walk the digest proof uses) | auditors | bridge redeploy; not a rewards phase |

Decided in the follow-up interview (spec §14): keccak-256 leaves, skim
`≤ min(ceil(fee / n_paid), 0.01 ADA)`, deregister = one atomic user tx.

## Guardrails for every phase

- Aiken v1.1.21: `pub fn` taking a redeemer or datum from `Data` must accept
  `Data` and `expect` inside; unused imports fail the build silently.
- New types only in `lib/rewards/types.ak`; nothing in `lib/logic/types.ak`.
- `is_singleton` from `lib/utils.ak` rejects any extra asset; deposit and
  pool value UTXOs need their own value predicates.
- Comments: one-line docstrings, no rationale paragraphs (see user rules).
- Validate at the boundary once (mint policy / withdraw script); spend
  gates trust it.

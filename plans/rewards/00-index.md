# Rewards implementation plan — index

Spec: [`docs/rewards/spec.md`](../../docs/rewards/spec.md). Each phase ends
with `just fmt && just build && just check && bun test` green and a `jj`
commit. No audited file is touched. No TypeScript until phase 06.

| Phase | File | Delivers | Depends on |
|---|---|---|---|
| 00 | [00-foundations.md](00-foundations.md) | `lib/rewards/{types,hash,auth}.ak`, config keys in 8 profiles, build-engine registration, test fixture helpers | — |
| 01 | [01-accounts.md](01-accounts.md) | `lib/rewards/linked_list.ak`, `lib/rewards/account.ak`, `validators/virtual_account.ak` + tests | 00 |
| 02 | [02-merkle-range.md](02-merkle-range.md) | `lib/rewards/merkle_range.ak` + Aiken-side tree builder for tests | 00 |
| 03 | [03-digest-proof.md](03-digest-proof.md) | `lib/rewards/digest.ak`: positional MMR verify, SCALE header parse, digest extraction + vectors | 00 |
| 04 | [04-pool-batcher.md](04-pool-batcher.md) | `validators/rewards_batcher.ak`, `validators/rewards_pool.ak`, `validators/staging_rewards_pool.ak`, `lib/rewards/batch.ak` + tests | 01, 02, 03 |
| 05 | [05-reserve-release.md](05-reserve-release.md) | `lib/rewards/{schedule,release}.ak`, rewritten `validators/reserve_v2.ak` + tests | 04 (pool hash) |
| 06 | [06-typescript.md](06-typescript.md) | CLI commands, prover, reference batcher, emulator e2e | 01–05 |

Phases 01, 02, 03 are independent and can run in parallel after 00.

## Open items that gate "done"

| Item | Owner | Blocks |
|---|---|---|
| Emission formula + per-network numbers | Jon / tokenomics | 05 final values (code uses config placeholders; interval = one Midnight epoch) |
| Digest payload SCALE layout (engine id `MNRW`, first block of `E + 1` decided) | node team | 03 extraction function; vectors |
| Midnight header hasher (BlakeTwo256 assumed) | node team | 03 |
| Even-block BEEFY commitment vector (bridge fold parity, spec §7.1) | relayer / bridge re-audit | nothing in rewards; informs the bridge |

Decided in the follow-up interview (spec §14): keccak-256 leaves, skim
`≤ min(ceil(fee / n_paid), 0.01 ADA)`, deregister = one atomic user tx,
mainnet reserve datum is the unit constructor.

## Guardrails for every phase

- Aiken v1.1.21: `pub fn` taking a redeemer or datum from `Data` must accept
  `Data` and `expect` inside; unused imports fail the build silently.
- New types only in `lib/rewards/types.ak`; nothing in `lib/logic/types.ak`.
- `is_singleton` from `lib/utils.ak` rejects any extra asset; deposit and
  pool value UTXOs need their own value predicates.
- Comments: one-line docstrings, no rationale paragraphs (see user rules).
- Validate at the boundary once (mint policy / withdraw script); spend
  gates trust it.

# Committee bridge implementation plan — index

Spec: [`docs/bridge/spec.md`](../../docs/bridge/spec.md); normative source is
the [Committee Bridge Consensus MIP](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/262).
Each phase ends with `just fmt && just build && just check && bun test`
green and one `jj` commit. Bridge files are edited in place (CLAUDE.md
exception); no other audited file is touched. No TypeScript until phase 05.

| Phase | File | Delivers | Depends on |
|---|---|---|---|
| 00 | [00-types-codec.md](00-types-codec.md) | `lib/bridge/types.ak`, `codec.ak`: MIP `Data` layouts, `u32` seats, 64-byte signatures, 48-byte commitment, MIP byte vectors | — |
| 01 | [01-verification.md](01-verification.md) | `lib/bridge/beefy.ak`, `merkle.ak`, `validators/committee_bridge.ak`: `required`, signatures zipped with leaves, rules 0–10, bootstrap checks, test fixtures | 00 |
| 02 | [02-threshold-max-fee.md](02-threshold-max-fee.md) | `BeefyThreshold` with `base`, `per_signer`; `beefy_validation`; logic reads the cap | 00 |
| 03 | [03-funding-pool.md](03-funding-pool.md) | `validators/committee_bridge_pool.ak`; rules 12–17 in the logic; `committee_bridge_pool_hash` in 8 profiles | 01, 02 |
| 04 | [04-signer-cap.md](04-signer-cap.md) | test-only builder at N = 50/100/150/200; `signer_cap` table in spec §11 | 03 |
| 05 | [05-ts-reference-vectors.md](05-ts-reference-vectors.md) | `tests/bridge/reference/*.ts` (`@noble/curves`, `@noble/hashes`); `tests/vectors/bridge/*.json`; Aiken fixtures mirror; VM round trip | 00, 01 |
| 06 | [06-cli-emulator.md](06-cli-emulator.md) | `deploy` covers the bridge triple, threshold, pool; `bridge-topup`, `bridge-update`, `bridge-info`; emulator e2e | 03, 05 |
| 07 | [07-private-network.md](07-private-network.md) | compact-end-2-end stack with `midnight-node` from `lglo/beefy-on-main`; `bridge-bootstrap` from RPC; datum recompute check | 06 (gated on the node branch) |

Phases 02 and 05 can run in parallel with 01 after 00.

## Open items that gate "done"

| Item | Owner | Blocks |
|---|---|---|
| Node: `u32` deduplicated commitment, root-only payload, `beef` key without fallback, rule 11 | node team | 07; vectors from a real node |
| `signer_cap` value | phase 04 here, then node team sets the D-parameter bound | MIP §Committee size |
| Collateral without a fee-paying wallet | node team / MIP open question | data pump, not a contract phase |
| On-chain misbehavior response | future MIP | nothing here |
| Six-hour epoch runtime upgrade | node team | 07 soak only |
| Re-audit of `lib/bridge/*`, `committee_bridge.ak`, `beefy_signer_threshold`, `committee_bridge_pool.ak` | auditors | deployment |
| `max_fee` base and per-signer amounts | measured in 04, set at deploy | 06 deploy config |

## Guardrails for every phase

- Aiken v1.1.21: `pub fn` taking a redeemer or datum from `Data` must accept
  `Data` and `expect` inside; unused imports fail the build silently. Run
  `aiken check` in a herdr tab, never through a pipe.
- No Aiken edits outside `lib/bridge/*`, `validators/committee_bridge.ak`,
  `validators/committee_bridge_pool.ak`, and the `beefy_signer_threshold`
  validator + `beefy_validation` in `validators/thresholds.ak`.
- MIP text governs. When code and this plan disagree with it, fix the code
  or record a deviation in spec §15 with a safety argument.
- Comments: one-line docstrings, no rationale paragraphs.
- Validate once at the boundary (the logic withdrawal); gates trust it.

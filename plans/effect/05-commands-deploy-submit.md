# Phase 05 — Deploy family and signing

Goal: the largest and most sensitive commands last, with the most
tested lib beneath them.

| Step | Command(s) | Lines | Notes |
|---|---|---|---|
| 1 | `deploy` | 1217 | split into `deploy/steps/*.ts`, one `Effect` per contract; `Effect.all` sequential with `Effect.tap` progress lines; the order and the output JSON unchanged |
| 2 | `deploy-staging-track`, `deploy-cnight-minting` | 874 | reuse the steps |
| 3 | `mint-tcnight`, `run-cnight-mint-mainnet` | 502 | mainnet paths need `Config` env guards as typed errors |
| 4 | `combine-signatures` | 379 | pure CBOR work; `tests/combine-signatures-cli.test.ts` imports `program` |
| 5 | `sign-and-submit` | 187 | `submit.ts` retry schedule; never run against a network in this phase (guardrail) |

## Acceptance
- `tests/basic_deploy.test.ts`, `federated_ops_deploy`, `deploy_thresholds`,
  `cnight-minting`, `mainnet_*` green.
- `bun cli-yargs/index.ts deploy -n local --dry-run` output identical to
  the pre-migration golden.

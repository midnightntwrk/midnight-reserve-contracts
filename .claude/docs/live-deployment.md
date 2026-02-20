# Live Deployment Runbook

Operational notes from live testing on node-dev-2. Apply to all non-emulator environments.

## One-Shot UTxO Setup (three separate simple-tx runs required)

One-shot hashes in `aiken.toml` must be updated manually before each build. Three separate
`simple-tx` runs are required for a full deployment — they cannot share a single tx because
each phase consumes all available outputs:

| Run | Purpose | aiken.toml keys to update |
|-----|---------|--------------------------|
| 1st | Main deployment | `*_one_shot_hash` (14 entries, indices 1–14) |
| 2nd | Staging track deploy | `*_staging_one_shot_hash` + `*_logic_v2_one_shot_hash` staging indices (12 entries, indices 0–5 each) |
| 3rd | v2 logic one-shots (mint-staging-state / stage-upgrade) | `*_logic_v2_one_shot_hash` (6 entries) |

**Order matters:** always run `sign-and-submit` and wait for on-chain confirmation before running
`just build <env>`. The build engine queries the deployer wallet to pick up new UTxOs; if you
build before confirmation, it parameterizes `aiken.toml` with stale hashes and deploy will fail
with `Unknown transaction input`.

## CLI Flag Reference

Flags that differ from what you might expect:

| Command | Flag | Note |
|---------|------|------|
| `info` | `--save` | Saves info.json + address-report.md to `release/<env>/`. Not `--fetch`. |
| `sign-and-submit` | positional `<json-file>` | Takes the tx file as a positional argument |
| `change-council`, `change-tech-auth`, `change-federated-ops`, `change-terms` | `--tx-hash`, `--tx-index` | Required: fee UTxO to spend. Query Blockfrost for a suitable UTxO before each call. |
| `change-terms` | `--hash`, `--url` | `--hash` is the T&C document hash (64 hex chars); `--url` is plain text (auto-converted to hex for on-chain storage) |
| `mint-staging-state`, `stage-upgrade`, `promote-upgrade` | `--validator <name>` | Required. E.g. `--validator council`, `--validator federated-ops` |
| `stage-upgrade`, `promote-upgrade`, `migrate-federated-ops` | `--tx-hash`, `--tx-index` | Required: fee UTxO to spend (same as change-* commands) |
| `combine-signatures` | `--tx`, `--signatures` | `--tx` is the unsigned tx JSON file; `--signatures` takes one or more witness file paths |
| `create-witnesses.ts` | positional `<tx-hash>` | Creates witness files in `./witnesses/` from TECH_AUTH_PRIVATE_KEYS + COUNCIL_PRIVATE_KEYS env vars |

## migrate-federated-ops Ordering

`migrate-federated-ops` correctly refuses to run until the v2 logic for that validator is
**promoted** (not just staged). The full order is:

```
stage-upgrade → sign-and-submit → promote-upgrade → sign-and-submit → migrate-federated-ops
```

## Full Deployment Sequence

```bash
# === Phase 1: Main deployment ===
bun run cli simple-tx --network <env>
bun run cli sign-and-submit <simple-tx.json> --network <env>
# Update *_one_shot_hash entries in aiken.toml (14 entries), then:
just build <env>
bun run cli deploy --network <env> --use-build
bun run cli sign-and-submit <deployment-transactions.json> --network <env>
bun run cli register-gov-auth --network <env>
bun run cli sign-and-submit <register-gov-auth-tx.json> --network <env>

# Governance changes (each requires --tx-hash + --tx-index from Blockfrost)
bun run cli change-council --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit <change-council-tx.json> --network <env>
bun run cli change-tech-auth --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit <change-tech-auth-tx.json> --network <env>
bun run cli change-federated-ops --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit <change-federated-ops-tx.json> --network <env>
bun run cli change-terms --network <env> --tx-hash <h> --tx-index <i> --hash <doc-hash> --url <url>
bun run cli sign-and-submit <change-terms-tx.json> --network <env>

bun run cli mint-tcnight --amount <amount> --user-address <addr> --network <env> --use-build
bun run cli sign-and-submit <mint-tcnight-tx.json> --network <env>

# === Phase 2: Staging track ===
bun run cli simple-tx --network <env>
bun run cli sign-and-submit <simple-tx.json> --network <env>
# Update *_staging_one_shot_hash + *_logic_v2_one_shot_hash (staging indices) in aiken.toml, then:
just build <env>
bun run cli deploy-staging-track --network <env> --use-build
bun run cli sign-and-submit <staging-track-deployment-transactions.json> --network <env>

# === Phase 3: v2 logic (per validator) ===
bun run cli simple-tx --network <env>
bun run cli sign-and-submit <simple-tx.json> --network <env>
# Update *_logic_v2_one_shot_hash (6 entries) in aiken.toml, then:
just build <env>
bun run cli mint-staging-state --validator <name> --network <env> --use-build
bun run cli sign-and-submit <mint-staging-state-tx.json> --network <env>
bun run cli stage-upgrade --validator <name> --network <env> --use-build --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit <stage-upgrade-tx.json> --network <env>
bun run cli promote-upgrade --validator <name> --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit <promote-upgrade-tx.json> --network <env>
bun run cli migrate-federated-ops --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit <migrate-federated-ops-tx.json> --network <env>

# === Phase 4: Downgrade a validator back to v1 logic ===
# Use --new-logic-hash with the original v1 logic hash (from deployed plutus.json)
# No --use-build needed — the v1 validator already exists in the deployed blueprint
bun run cli stage-upgrade --validator <name> --new-logic-hash <v1-logic-hash> --tx-hash <h> --tx-index <i> --network <env>
bun run cli sign-and-submit <stage-upgrade-tx.json> --network <env>
bun run cli promote-upgrade --validator <name> --tx-hash <h> --tx-index <i> --network <env>
bun run cli sign-and-submit <promote-upgrade-tx.json> --network <env>

# === Phase 5: Test combine-signatures (multi-party signing flow) ===
# Build an unsigned governance tx (change-council has multiple required signers)
bun run cli change-council --network <env> --tx-hash <h> --tx-index <i> --output-file change-council-combine-test.json

# Extract the tx hash from the unsigned transaction
TX_HASH=$(bun -e "
  const {Transaction, TxCBOR, HexBlob} = require('@blaze-cardano/core');
  const fs = require('fs');
  const tx = JSON.parse(fs.readFileSync('deployments/<env>/change-council-combine-test.json','utf8'));
  console.log(Transaction.fromCbor(TxCBOR(HexBlob(tx.cborHex))).getId());
")

# Create witness files from tech-auth + council signing keys
bun create-witnesses.ts $TX_HASH

# Combine witnesses and submit (--sign-deployer adds deployer sig automatically)
bun run cli combine-signatures \
  --tx deployments/<env>/change-council-combine-test.json \
  --signatures witnesses/witness-1.json witnesses/witness-2.json witnesses/witness-3.json \
    witnesses/witness-4.json witnesses/witness-5.json witnesses/witness-6.json \
  --network <env>

# === Final verification ===
bun run cli info --network <env> --save
bun run cli verify --network <env>
```

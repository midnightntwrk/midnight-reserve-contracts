# Live deployment runbook

How to deploy and operate the contracts on a live environment (preview,
qanet, govnet, devnet, preprod, mainnet) with the CLI. Every command below
only writes a transaction file, except `sign-and-submit` and
`combine-signatures`, which submit for real.

## One-shot UTxOs

Every deployment transaction spends a one-shot UTxO the aiken.toml profile
names; the contracts are compiled against those references, so they must
exist, unspent, at the deployer address before the build.

| Phase | aiken.toml keys |
|---|---|
| Main deployment | `*_one_shot_hash` / `*_one_shot_index` and `collateral_utxo_*` |
| Staging track | `*_staging_one_shot_*` |
| v2 logic (mint-staging-state) | `*_logic_v2_one_shot_*` |

Create the UTxOs with `simple-tx` (`--count`, `--amount`), submit it, and
wait for it to be on chain before `just build <env>`: the build reads the
profile, and a deploy over references the chain does not hold fails with
`UTxO … not found at <deployer>`. The CLI never spends a one-shot or the
collateral to pay fees.

A deployment file holds several transactions. `sign-and-submit` submits
them all, then waits for each: when a transaction spends the change of the
one before (one-shots too small to pay their own way), the node takes the
chain from its mempool.

## Flags worth knowing

| Command | Flag | Note |
|---|---|---|
| `sign-and-submit` | positional `<json-file>` | a transaction file or a deployment file; `--no-sign-deployer` leaves the deployer's signature out |
| `combine-signatures` | `--tx <file>` and positional `<witness-file...>` | witnesses from `cardano-cli transaction witness` or CIP-30 wallets; adds the deployer's signature and submits |
| `change-*`, `stage-upgrade`, `promote-upgrade`, `migrate-federated-ops`, `register-cnight-mint-logic`, `run-cnight-mint-mainnet`, `merge-utxos` | `--tx-hash`, `--tx-index` | the deployer UTxO that pays the fee; it must carry no reference script. Pick it from the deployer's address listing (Blockfrost `/addresses/{address}/utxos`), never from a transaction's outputs: `/txs/{hash}/utxos` also lists the collateral-return output (`"collateral": true`), which exists only if that transaction failed phase 2; after a successful transaction the CLI refuses it as not found |
| `change-*`, `stage-upgrade`, `promote-upgrade` | `--no-sign` | leave the authorities' signatures out (signing reads `TECH_AUTH_PRIVATE_KEYS` and `COUNCIL_PRIVATE_KEYS`) |
| `change-terms` | `--hash`, `--url` | `--hash` is the document hash (64 hex chars); `--url` is plain text, stored as hex |
| `mint-staging-state`, `stage-upgrade`, `promote-upgrade` | `--validator <name>` | e.g. `council`, `federated-ops` |
| `stage-upgrade` | `--new-logic-hash` | a hash in the record or in the build; a build-only logic is copied into the record |
| `promote-upgrade` | `--use-build` | look the staged logic up in the build instead of the record |
| `deploy`, `deploy-staging-track` | `--components` | only those transactions; a deploy without it on a test environment replaces the record |
| `info` | `--save` | writes `info.json` and `address-report.md` under `release/<env>/` |

## Order of a v2 migration

`migrate-federated-ops` refuses until the v2 logic is promoted, not just
staged:

```
stage-upgrade → sign-and-submit → promote-upgrade → sign-and-submit → migrate-federated-ops
```

## Full sequence

```bash
# Phase 1: main deployment
just cli simple-tx -n <env>
just cli sign-and-submit -n <env> deployments/<env>/simple-tx.json
# Set the *_one_shot_* entries and collateral_utxo_* in aiken.toml, then:
just build <env>
just cli deploy -n <env>
just cli sign-and-submit -n <env> deployments/<env>/deployment-transactions.json
just cli register-gov-auth -n <env>
just cli sign-and-submit -n <env> deployments/<env>/register-gov-auth-tx.json

# Governance changes
just cli change-council -n <env> --tx-hash <h> --tx-index <i>
just cli sign-and-submit -n <env> deployments/<env>/change-council-tx.json
just cli change-tech-auth -n <env> --tx-hash <h> --tx-index <i>
just cli change-federated-ops -n <env> --tx-hash <h> --tx-index <i>
just cli change-terms -n <env> --tx-hash <h> --tx-index <i> --hash <doc-hash> --url <url>
just cli mint-tcnight -n <env> --amount <n> --user-address <addr>

# Phase 2: staging track
just cli simple-tx -n <env>
# Set the *_staging_one_shot_* entries, then:
just build <env>
just cli deploy-staging-track -n <env>
just cli sign-and-submit -n <env> deployments/<env>/staging-track-deployment-transactions.json

# Phase 3: v2 logic, per validator
just cli simple-tx -n <env>
# Set the *_logic_v2_one_shot_* entries, then:
just build <env>
just cli mint-staging-state -n <env> --validator <name>
just cli stage-upgrade -n <env> --validator <name> --new-logic-hash <v2-logic-hash> --tx-hash <h> --tx-index <i>
just cli promote-upgrade -n <env> --validator <name> --tx-hash <h> --tx-index <i>
just cli migrate-federated-ops -n <env> --tx-hash <h> --tx-index <i>

# Back to v1: stage and promote the v1 logic hash from the record
just cli stage-upgrade -n <env> --validator <name> --new-logic-hash <v1-logic-hash> --tx-hash <h> --tx-index <i>
just cli promote-upgrade -n <env> --validator <name> --tx-hash <h> --tx-index <i>

# Signing by several parties
just cli change-council -n <env> --tx-hash <h> --tx-index <i> --no-sign --output-file change-council-unsigned.json
# Each signer witnesses the transaction with cardano-cli or a CIP-30 wallet, then:
just cli combine-signatures -n <env> --tx deployments/<env>/change-council-unsigned.json witness-1.json witness-2.json

# Check
just cli info -n <env> --save
just cli verify -n <env>
```

Each `just cli <command>` writes `deployments/<env>/<command>-tx.json`
(`--output-file` names it); sign and submit it with
`just cli sign-and-submit -n <env> <file>` before the next step that reads
its result.

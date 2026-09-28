# Live Deployment Runbook

Operational notes from live testing on devnet. Apply to all non-emulator environments.

## One-Shot UTxO Setup (three separate simple-tx runs required)

One-shot hashes in `aiken.toml` must be updated manually before each build. Three separate
`simple-tx` runs are required for a full deployment — they cannot share a single tx because
each phase consumes all available outputs:

| Run | Purpose | aiken.toml keys to update |
|-----|---------|--------------------------|
| 1st | Main deployment | the main `*_one_shot_hash` keys (15 entries; indices 0–14 in every profile except `default`) |
| 2nd | Staging track deploy | `*_staging_one_shot_hash` (6 entries) |
| 3rd | v2 logic one-shots (mint-staging-state / stage-upgrade) | `*_logic_v2_one_shot_hash` (6 entries) |

Of the 15 main keys, `deploy` reads 12: `technical_authority`, `main_tech_auth_update`,
`council`, `main_council_update`, `reserve`, `ics`, `main_gov`, `staging_gov`,
`federated_operators`, `main_federated_ops_update`, `terms_and_conditions` and
`terms_and_conditions_threshold` (each `<name>_one_shot_hash` / `_index`). No command reads
`cnight_minting_one_shot_*` (`deploy-cnight-minting` was deleted). The bridge components
of `deploy` read `committee_bridge_one_shot_*` (`committee-bridge`) and
`committee_threshold_one_shot_*` (`committee-bridge-threshold`); `committee-bridge-scripts`
spends no one-shot. The rewards components read `rewards_pool_one_shot_*` (`rewards-pool`),
`rewards_batcher_one_shot_*` (`rewards-batcher`) and `virtual_account_one_shot_*`
(`virtual-account`); `virtual-account-stake` spends no one-shot.

`deploy-staging-track` reads only the six `*_staging_one_shot_*` keys
(`cli/deploy/staging-track.ts`). The `*_logic_v2_one_shot_*` keys belong to the 3rd run:
`mint-staging-state` reads them, and the v2 logic validators that `stage-upgrade` stages embed
them.

**Order matters:** always run `sign-and-submit` and wait for on-chain confirmation before running
`deploy`. The one-shot hashes in `aiken.toml` are set by hand; `just build <env>` does not query
the chain. `deploy` and `deploy-staging-track` find the collateral and every selected one-shot among the
deployer's unspent outputs on chain before they build; one that is missing or spent is `UtxoNotFound` naming
its `hash#index`, and nothing is written.

## CLI Flag Reference

Flags that differ from what you might expect:

| Command | Flag | Note |
|---------|------|------|
| `info` | `--save` | Saves info.json + address-report.md to `release/<env>/`. Not `--fetch`. Reads the UTxOs through `--provider` (default: the environment's), as `verify` does; `local` and `emulator` are refused. |
| `dust-participants` | `--provider` | Reads the UTxOs at `cnight_generates_dust` through the chain provider (default: the environment's), as `verify` does; `local` and `emulator` are refused. |
| `sign-and-submit` | positional `<json-file>` | The path of the tx file, e.g. `deployments/<env>/change-council-tx.json` |
| every tx-building command | `--output`, `--output-file` | The file lands at `<--output, default ./deployments>/<env>/<--output-file>`. `deploy` and `deploy-staging-track` write the fixed names `deployment-transactions.json` and `staging-track-deployment-transactions.json`. |
| every tx-building command | — | Coin selection never spends a deployer UTxO that the environment's aiken.toml profile names (the one-shots and `collateral_utxo`) or one that carries a reference script, so the transactions of one `deploy` run never share an input. |
| `change-council`, `change-tech-auth`, `change-federated-ops`, `change-terms` | `--tx-hash`, `--tx-index` | Required: fee UTxO to spend. Query Blockfrost for a suitable UTxO before each call. |
| `change-*`, `stage-upgrade`, `promote-upgrade`, `mint-staging-state` | `--no-sign` | Without it the command signs with `TECH_AUTH_PRIVATE_KEYS` and `COUNCIL_PRIVATE_KEYS` (`mint-staging-state`: `TECH_AUTH_PRIVATE_KEYS` only). `--no-sign` writes an unsigned tx for external signers (Phase 5). |
| `change-terms` | `--hash`, `--url` | `--hash` is the T&C document hash (64 hex chars); `--url` is plain text (auto-converted to hex for on-chain storage) |
| `mint-staging-state`, `stage-upgrade`, `promote-upgrade` | `--validator <name>` | Required. E.g. `--validator council`, `--validator federated-ops` |
| `stage-upgrade`, `promote-upgrade`, `migrate-federated-ops`, `merge-utxos`, `register-cnight-mint-logic` | `--tx-hash`, `--tx-index` | Required: fee UTxO to spend (same as change-* commands) |
| `deploy` | `--components` | Deploy sets up contracts that are not live yet; a change to a live contract is an upgrade (`stage-upgrade`, `promote-upgrade`), never a deploy. With no `--components`, a full run builds the twelve governance components (the bridge components only when named). `--components <list>` (comma-separated, at least one name) builds only the transactions of those components, and `deployment-transactions.json` then holds only them, so `sign-and-submit` sends only them. Each component is one transaction that creates all of its validators (see [deploy --components](#deploy---components)). |
| `deploy` | — | Each run writes the snapshot `deployed-scripts/<env>/` when it builds the transactions, before they are submitted. A full run on a test environment starts it again: `plutus.json` and the blueprint from the build, `versions.json` promoted = the validators this deploy creates, staged = []. A `--components` run, and every run on `preprod` and `mainnet`, extends it: the build must match the live snapshot (every promoted or staged validator the run does not create, and the gov auths its datums install, has the same hash in the build), else the run is refused before any chain call and names `bun cli build -n <env> --from-deployed --components <the same list>`, which pins the deployed two-stage, forever and threshold hashes except those of the named components and compiles those from new; the snapshot then takes the build's entries and keeps a title only it has, and promoted gains the created validators and the installed gov auths. On `preprod` and `mainnet` the whole run is refused before it builds anything if one selected validator is already promoted in `versions.json` (promotion is permanent). The snapshot is written before `deployment-transactions.json`, so a snapshot that cannot be written fails the command and leaves no file to sign. An extend appends its entries, each with its own `timestamp`, to `changelog.json`, and keeps the file's first `timestamp` and its `gitCommit`. |
| `deploy-staging-track` | `--components` | Builds the six staging forever transactions that start the upgrade flow (Phase 2). `--components` takes its own six names (`council`, `tech-auth`, `federated-ops`, `reserve`, `ics`, `terms-and-conditions`), and the file holds only their transactions. It extends `deployed-scripts/<env>/` with the staging forevers it creates, as a `deploy --components` run does: the build must match the live snapshot, else the run is refused before any chain call and names `bun cli build -n <env> --from-deployed`; `plutus.json` takes the build's entries, `versions.json` promotes the created staging forevers, and `changelog.json` gains them. On `preprod` and `mainnet` a selected staging forever that `versions.json` already promotes is refused. The snapshot is written before `staging-track-deployment-transactions.json`. |
| `stage-upgrade`, `promote-upgrade` | — | Building the tx updates the staged/promoted lists in `deployed-scripts/<env>/versions.json`, before it is submitted. `stage-upgrade` finds `--new-logic-hash` in `deployed-scripts/<env>/plutus.json`, else in the build output `plutus-<profile>.json`, and then copies that one validator into `deployed-scripts/<env>/plutus.json`; a hash in neither is refused before any chain call. A copy overwrites a staged, unpromoted entry of that name; a build logic whose name `versions.json` promotes is refused (a promoted validator keeps its hash). |
| `register-gov-auth`, `register-cnight-mint-logic`, `stage-upgrade`, `promote-upgrade` | — | Check stake registration through Blockfrost whatever `--provider` is, so `BLOCKFROST_<NETWORK>_API_KEY` must be set. The register commands refuse a credential that is already registered. |
| `bridge-update` | `--update <file>`, `--funded` | The file is a `BridgeUpdate` in JSON: the blueprint field names, integers as numbers, lower-case hex, the multiproof as the CBOR hex of its Data. `--funded` spends every pool UTxO with no datum hash and debits min(fee, cap, pool − its minimum output); a funded update that is no handover, or over a pool at or below its minimum output, is refused before any build. The deployer submits and pays the rest of the fee. |
| `bridge-topup` | `--lovelace` | Pays the pool; unsigned, for `sign-and-submit`. |
| `bridge-bootstrap` | `--rpc`, `--activation` | Reads the MIP bootstrap from a Midnight node's HTTP JSON-RPC (`http://host:9944`): the MMR root in the digest of block `activation − 1` and the committees `pallet-beefy-mmr` holds at `activation`. Prints the four `BRIDGE_*` bootstrap lines for `.env`. The activation block must be final. Needs no Cardano network. |
| `bridge-verify-bootstrap` | `--rpc` | Diffs the deployed light client against its bootstrap recomputed from the node, and checks that the leaf of the activation block `b` is index `b − 1` of `b` (`mmr_generateProof`). Fails on any mismatch; true on a fresh deployment only, since each update moves the root and the height. |
| `bridge-fetch-justification` | `--rpc`, `--block` | Writes the `BridgeUpdate` of block `--block`'s BEEFY justification to `<--output>/<env>/bridge-justification.json`, for `bridge-update --update`. Reads the threshold UTxO and keeps a minimal cover of its fraction (rule 6 rejects a surplus signer). A handover is the first block of a session; a block with no BEEFY justification is refused. |
| `pump` | `--rpc`, `--signing-key`, `--poll` | Runs until stopped. Each round runs two jobs in order. The handover: it takes the light client's next committee, finds its first Midnight block once BEEFY has finalized it, and lands the funded handover from that block's justification, as `bridge-update --funded` builds it. The release: once a whole interval has passed, it lands `rewards-release`. A job signs with the deployer key, submits and awaits. A round that lands a job starts the next at once, so a backlog lands oldest first; otherwise, or after a failed job (logged), it waits `--poll` seconds. Submits transactions. |
| `rewards-release` | none | Writes the reserve's release into the rewards pool for the whole intervals since the reserve NFT's last release (`release_*` keys of the profile; the deploy datum means `release_t0_ms`), filling the pool to the ceiling of those intervals net of what it holds (docs/rewards/spec.md §8), to `<--output>/<env>/rewards-release.json`, unsigned. Refused before a whole interval has passed, and while the reserve does not run `reserve_logic_v2`. |
| `bridge-set-fee`, `bridge-set-threshold` | `--base`, `--per-signer` / `--threshold`, `--tx-hash`, `--tx-index`, `--no-sign` | Spend the BEEFY threshold under Council + Tech Auth, as the `change-*` commands do: the new fee cap keeps the fraction, the new fraction keeps the fee cap. |
| `combine-signatures` | `--tx`, positional `<witness-file>...` | `--tx` holds exactly one transaction (for a deployment file use `sign-and-submit`); one or more witness files follow the options (a shell glob such as `<witness-dir>/*.json` works). Without `--no-sign-deployer` it also signs with `SIGNING_PRIVATE_KEY`. Submits. |

## deploy --components

Each component is one deploy transaction, and that transaction creates all of the component's validators:

| Component | Validators it creates |
|-----------|-----------------------|
| `tech-auth`, `council`, `reserve`, `ics`, `federated-ops`, `terms-and-conditions` | `<name>_two_stage_upgrade`, `<name>_forever`, `<name>_logic` |
| `tech-auth-threshold`, `council-threshold`, `federated-ops-threshold` | `main_<name>_update_threshold` |
| `main-gov`, `staging-gov`, `terms-and-conditions-threshold` | `main_gov_threshold`, `staging_gov_threshold`, `terms_and_conditions_threshold` |
| `committee-bridge` | `committee_bridge_two_stage_upgrade`, `committee_bridge_forever`, `committee_bridge_logic`, `committee_bridge_pool` (the forever holds the bootstrap state from the `BRIDGE_*` env values) |
| `committee-bridge-threshold` | `beefy_signer_threshold` (`--bridge-threshold` / `BRIDGE_THRESHOLD`, then `BRIDGE_MAX_FEE_BASE`, `BRIDGE_MAX_FEE_PER_SIGNER`); the transaction also registers `committee_bridge_logic` |
| `committee-bridge-scripts` | none: reference-script UTxOs of the bridge forever, logic and pool at the deployer address, which the CLI's coin selection never spends |
| `rewards-pool` | `rewards_pool_two_stage_upgrade`, `rewards_pool_forever`, `rewards_pool_logic`; the transaction registers `rewards_pool_logic` |
| `rewards-batcher` | `rewards_batcher`: the state NFT with the first state (`REWARDS_FIRST_EPOCH` − 1, complete), serving `virtual_account` and `rewards_pool_forever`; the transaction registers `rewards_batcher` |
| `virtual-account-stake` | none: registers the `virtual_account` stake credential, which `virtual-account` withdraws from in a later transaction |
| `virtual-account` | `virtual_account`: the list head and tail, under the InitList withdrawal |
| `rewards-batcher-script` | none: a reference-script UTxO of `rewards_batcher` at the deployer address (alone: 10,072 bytes silent) |
| `rewards-scripts` | none: reference-script UTxOs of `virtual_account`, `rewards_pool_forever` and `rewards_pool_logic` at the deployer address; the batches and the registrations spend through them |

The bridge and rewards components are outside the default set: a run without `--components` builds the twelve governance transactions, and the others are built only when named. Build the rewards contracts with `--trace silent`: at the verbose trace `rewards_batcher` is 18,475 bytes, above the 16,384-byte transaction limit; silent it is 10,072. The bridge triple does not fit one transaction with the logic registration (17,156 script bytes at the verbose trace), so the registration rides on the threshold transaction.

Set up an environment in two parts (each run writes the file again with only its transactions, so submit it before the next run; the snapshot keeps both parts):

```bash
bun run cli deploy -n preview --components tech-auth,tech-auth-threshold,council,council-threshold
bun run cli sign-and-submit deployments/preview/deployment-transactions.json -n preview
bun run cli deploy -n preview --components reserve,ics,main-gov,staging-gov,federated-ops,federated-ops-threshold,terms-and-conditions,terms-and-conditions-threshold
bun run cli sign-and-submit deployments/preview/deployment-transactions.json -n preview
```

Set up one part again on a test environment (a new contract with a new NFT and address; the old one stays on chain unused). Do this before the staging track only: each staging forever embeds its two-stage hash (`reserve_staging_forever` embeds `reserve_two_stage_hash`, `validators/staging_reserve_ics.ak`), and a new one-shot gives a new two-stage hash.

```bash
bun run cli simple-tx -n preview
bun run cli sign-and-submit deployments/preview/simple-tx.json -n preview
# set reserve_one_shot_hash / reserve_one_shot_index in [config.preview], then:
just build preview
bun run cli deploy -n preview --components reserve
bun run cli sign-and-submit deployments/preview/deployment-transactions.json -n preview
```

Build again one transaction that failed to submit: `--components <its component>`; the file holds only that transaction. Its one-shot must still be unspent; if it is spent, replace it as above. On `preprod` and `mainnet` the first run already promoted its validators in `versions.json`, so the rebuild is refused until an operator edits `versions.json`.

On `preprod` and `mainnet` a selection with any promoted validator is refused as a whole; a component whose validators are all promoted cannot be deployed again there.

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
bun run cli sign-and-submit deployments/<env>/simple-tx.json --network <env>
# Update the 12 deploy one-shots in aiken.toml (see the one-shot table), and
# collateral_utxo_hash / collateral_utxo_index (required TxHash + index in every profile;
# deploy and deploy-staging-track check the collateral on chain), then:
just build <env>
# The full deploy is only for a new environment. It is refused on preprod and mainnet.
# On a test environment it replaces deployed-scripts/<env>/ and drops later --components additions.
bun run cli deploy --network <env>
bun run cli sign-and-submit deployments/<env>/deployment-transactions.json --network <env>
bun run cli register-gov-auth --network <env>
bun run cli sign-and-submit deployments/<env>/register-gov-auth-tx.json --network <env>

# Governance changes (each requires --tx-hash + --tx-index from Blockfrost;
# signed with TECH_AUTH_PRIVATE_KEYS + COUNCIL_PRIVATE_KEYS by default)
bun run cli change-council --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit deployments/<env>/change-council-tx.json --network <env>
bun run cli change-tech-auth --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit deployments/<env>/change-tech-auth-tx.json --network <env>
bun run cli change-federated-ops --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit deployments/<env>/change-federated-ops-tx.json --network <env>
bun run cli change-terms --network <env> --tx-hash <h> --tx-index <i> --hash <doc-hash> --url <url>
bun run cli sign-and-submit deployments/<env>/change-terms-tx.json --network <env>

# === Phase 1b: Committee bridge (after the base; its own --components run) ===
# Print the bootstrap lines from a Midnight node, then set BRIDGE_ACTIVATION_BLOCK,
# BRIDGE_MMR_ROOT, BRIDGE_CURRENT_COMMITTEE, BRIDGE_NEXT_COMMITTEE,
# BRIDGE_MAX_FEE_BASE and BRIDGE_MAX_FEE_PER_SIGNER (and BRIDGE_THRESHOLD, else 2/3)
# in .env; see .env.example.
bun run cli bridge-bootstrap --rpc http://<node>:9944 --activation <block>
bun run cli simple-tx --network <env>
bun run cli sign-and-submit deployments/<env>/simple-tx.json --network <env>
# Update committee_bridge_one_shot_* and committee_threshold_one_shot_* in aiken.toml, then:
just build <env>
bun run cli deploy --network <env> --components committee-bridge,committee-bridge-threshold,committee-bridge-scripts
bun run cli sign-and-submit deployments/<env>/deployment-transactions.json --network <env>
bun run cli bridge-info --network <env>
bun run cli bridge-verify-bootstrap --network <env> --rpc http://<node>:9944
bun run cli bridge-topup --network <env> --lovelace <amount>
bun run cli sign-and-submit deployments/<env>/bridge-topup.json --network <env>
# Every handover from here on, oldest first, until stopped (submits):
bun run cli pump --network <env> --rpc http://<node>:9944
# Or one handover by hand (the first block of a session):
bun run cli bridge-fetch-justification --network <env> --rpc http://<node>:9944 --block <block>
bun run cli bridge-update --network <env> --funded --update deployments/<env>/bridge-justification.json
bun run cli sign-and-submit deployments/<env>/bridge-update.json --network <env>

# Test environments only (mint-tcnight refuses mainnet):
bun run cli mint-tcnight --amount <amount> --user-address <addr> --network <env>
bun run cli sign-and-submit deployments/<env>/mint-tcnight-tx.json --network <env>

# === Phase 2: Staging track ===
bun run cli simple-tx --network <env>
bun run cli sign-and-submit deployments/<env>/simple-tx.json --network <env>
# Update *_staging_one_shot_hash / _index (6 entries) in aiken.toml, then:
just build <env>
bun run cli deploy-staging-track --network <env>
bun run cli sign-and-submit deployments/<env>/staging-track-deployment-transactions.json --network <env>

# === Phase 3: v2 logic (per validator) ===
bun run cli simple-tx --network <env>
bun run cli sign-and-submit deployments/<env>/simple-tx.json --network <env>
# Update *_logic_v2_one_shot_hash (6 entries) in aiken.toml, then:
just build <env>
bun run cli mint-staging-state --validator <name> --network <env>
bun run cli sign-and-submit deployments/<env>/mint-staging-state-tx.json --network <env>
# <v2-logic-hash>: the <track>_logic_v2 hash in plutus-<profile>.json; stage-upgrade copies it into deployed-scripts
bun run cli stage-upgrade --validator <name> --network <env> --new-logic-hash <v2-logic-hash> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit deployments/<env>/stage-upgrade-tx.json --network <env>
bun run cli promote-upgrade --validator <name> --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit deployments/<env>/promote-upgrade-tx.json --network <env>
bun run cli migrate-federated-ops --network <env> --tx-hash <h> --tx-index <i>
bun run cli sign-and-submit deployments/<env>/migrate-federated-ops-tx.json --network <env>

# === Phase 4: Downgrade a validator back to v1 logic ===
# Use --new-logic-hash with the original v1 logic hash (from deployed plutus.json)
# The v1 validator is already in deployed-scripts, so nothing is copied
bun run cli stage-upgrade --validator <name> --new-logic-hash <v1-logic-hash> --tx-hash <h> --tx-index <i> --network <env>
bun run cli sign-and-submit deployments/<env>/stage-upgrade-tx.json --network <env>
bun run cli promote-upgrade --validator <name> --tx-hash <h> --tx-index <i> --network <env>
bun run cli sign-and-submit deployments/<env>/promote-upgrade-tx.json --network <env>

# === Phase 5: Multi-party signing (combine-signatures) ===
# Build the tx unsigned: governance commands sign by default, so pass --no-sign.
# Writes deployments/<env>/change-council-combine-test.json; send it to each signer.
bun run cli change-council --network <env> --tx-hash <h> --tx-index <i> --no-sign --output-file change-council-combine-test.json

# Each signer writes one fresh witness file, into a directory outside the repo.
# Collect enough council and tech-auth signers to meet both thresholds.
# cardano-cli 10.14 (it rejects --tx-file; the CLI's tx JSON is a valid --tx-body-file):
cardano-cli conway transaction witness \
  --tx-body-file deployments/<env>/change-council-combine-test.json \
  --signing-key-file <signer>.skey \
  --out-file <witness-dir>/<signer>.json
# <signer>.skey for a raw 32-byte hex key (keep it out of the repo):
#   {"type":"PaymentSigningKeyShelley_ed25519","description":"","cborHex":"5820<32-byte hex key>"}
# A CIP-30 wallet instead: save the hex of signTx(<cborHex of the tx file>, true) as the witness file.

# combine-signatures accepts a cardano-cli key witness (tagged [0,[vkey,sig]] or
# untagged [vkey,sig], which 10.14 writes) or a CIP-30 witness-set CBOR hex. It refuses
# a signature that does not verify against the tx id, and a signer twice with different
# signatures. It adds the SIGNING_PRIVATE_KEY signature unless --no-sign-deployer is given.
# witnesses/witness-*.json are test fixtures for an old tx; never pass them here.
# The witness files follow the options; <witness-dir>/*.json passes every file in the directory.
bun run cli combine-signatures \
  --tx deployments/<env>/change-council-combine-test.json \
  --network <env> \
  <witness-dir>/<signer-1>.json <witness-dir>/<signer-2>.json ...

# === Final verification ===
bun run cli info --network <env> --save
# verify reads deployed-scripts/<env>/ (plutus.json, versions.json) and the unspent outputs
# at its scripts: every forever embeds its two-stage hash, every forever, two-stage main and
# staging and threshold NFT sits in exactly one output at its script, and every UpgradeState
# names the record's gov auth, a logic of its track (<track>_logic or <track>_logic_v<N>) that
# versions.json promoted (main) or promoted or staged (staging), and a mitigation logic and
# mitigation auth that are each empty or in the record. The six core tracks are always
# checked; cNIGHT minting too where versions.json promotes cnight_mint_forever.
bun run cli verify --network <env>
```

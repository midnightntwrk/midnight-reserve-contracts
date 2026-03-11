# CLI Reference

Reference for the `cli-yargs/` command-line interface: flags, environment variables, and network mapping.

For transaction-level specifications (validators fired, inputs, outputs, constraints), see [transactions.md](transactions.md).

## 1. Commands

| Command | Description |
|---|---|
| `deploy` | Generate initial deployment transactions (one-shot, always uses build blueprint) |
| `deploy-staging-track` | Deploy staging track forever validators (one-shot, always uses build blueprint) |
| `deploy-cnight-minting` | Deploy cNIGHT minting two-stage upgrade contracts (one-shot, always uses build blueprint) |
| `change-council` | Update council multisig state |
| `change-tech-auth` | Update technical authority multisig state |
| `change-federated-ops` | Update federated operators state |
| `change-terms` | Update terms and conditions |
| `migrate-federated-ops` | Migrate federated ops to new logic (always unsigned) |
| `mint-staging-state` | Mint StagingState NFT for a v2 logic contract (always uses build blueprint) |
| `mint-tcnight` | Mint or burn TCnight tokens (non-mainnet only) |
| `stage-upgrade` | Stage a v2 logic upgrade |
| `promote-upgrade` | Promote a staged upgrade to main track |
| `register-gov-auth` | Register gov auth scripts as stake credentials |
| `simple-tx` | Generate dust/funding transactions |
| `info` | Display contract addresses and deployment info |
| `verify` | Verify on-chain state against expected configuration |
| `generate-key` | Generate a new signing key |
| `sign-and-submit` | Sign and submit a transaction to the network |
| `combine-signatures` | Combine multiple signatures into a signed transaction |
| `build` | Build Aiken contracts |
| `build-from-deployed` | Build contract blueprint from deployed scripts |

## 2. Flag Inventory

### Global flags

| Flag | Short | Type | Default | Used by |
|---|---|---|---|---|
| `--network` | `-n` | `string` | `"local"` | All commands |
| `--output` | `-o` | `string` | `resolve("./deployments")` | Most tx-building commands |
| `--provider` | `-p` | `ProviderType` | `getDefaultProvider(network)` | Most networked commands |

### Shared command flags

| Flag | Short | Type | Default | Used by |
|---|---|---|---|---|
| `--use-build` | none | `boolean` | `false` | `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `info`, `stage-upgrade`, `change-terms` |
| `--sign` / `--no-sign` | none | `boolean` | `true` | `change-council`, `change-tech-auth`, `change-federated-ops`, `mint-staging-state`, `stage-upgrade`, `promote-upgrade`, `change-terms` |
| `--output-file` | none | `string` | per command (see below) | `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `mint-staging-state`, `simple-tx`, `stage-upgrade`, `promote-upgrade`, `register-gov-auth`, `mint-tcnight`, `change-terms` |
| `--validator` | `-v` | `string` | unset | `mint-staging-state`, `stage-upgrade`, `promote-upgrade` |
| `--tx-hash` | none | `string` | unset | `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `stage-upgrade`, `promote-upgrade` |
| `--tx-index` | none | `number` | unset | same as `--tx-hash` |
| `--components` | none | comma-delimited `string` | `[]` (means all) | `deploy`, `deploy-staging-track` |
| `--name` | none | `string` | unset | `deploy`, `deploy-staging-track` |

### Deploy-specific flags

| Flag | Type | Default | Used by |
|---|---|---|---|
| `--utxo-amount` | `string` (bigint) | `getDeployUtxoAmount()` | `deploy`, `deploy-staging-track`, `deploy-cnight-minting` |
| `--tech-auth-threshold` | threshold `n/d` | `getTechAuthThreshold()` | `deploy` |
| `--council-threshold` | threshold `n/d` | `getCouncilThreshold()` | `deploy` |
| `--council-staging-threshold` | threshold `n/d` | `getCouncilStagingThreshold()` | `deploy` |
| `--tech-auth-staging-threshold` | threshold `n/d` | `getTechAuthStagingThreshold()` | `deploy` |

### Command-specific flags

| Flag | Short | Type | Default | Command |
|---|---|---|---|---|
| `--new-logic-hash` | none | `string` | unset | `stage-upgrade` |
| `--count` | none | `number` | `getSimpleTxCount()` | `simple-tx` |
| `--amount` | none | `string` (bigint) | `getSimpleTxAmount()` | `simple-tx`, `mint-tcnight` |
| `--to` | none | `string` | deployer address | `simple-tx` |
| `--format` | none | `"json"` \| `"table"` | `"table"` | `info` |
| `--component` | none | `string` | `"all"` | `info` |
| `--save` | none | `boolean` | `false` | `info` |
| `--release-dir` | none | `string` | `./release` | `info` |
| `--signing-key` | none | `string` (env var name) | `"SIGNING_PRIVATE_KEY"` | `sign-and-submit`, `combine-signatures` |
| `--sign-deployer` / `--no-sign-deployer` | none | `boolean` | `true` | `sign-and-submit`, `combine-signatures` |
| `--tx` | none | `string` | required | `combine-signatures` |
| `--signatures` | none | `string[]` | required | `combine-signatures` |
| `--user-address` | `-u` | `string` | required | `mint-tcnight` |
| `--destination` | `-d` | `string` | user address | `mint-tcnight` |
| `--burn` | `-b` | `boolean` | `false` | `mint-tcnight` |
| `--hash` | none | `string` | required | `change-terms` |
| `--url` | none | `string` | required | `change-terms` |
| `--trace` | none | `string` | `"verbose"` | `build`, `build-from-deployed` |

### `--output-file` defaults by command

| Command | Default |
|---|---|
| `change-council` | `change-council-tx.json` |
| `change-tech-auth` | `change-tech-auth-tx.json` |
| `change-federated-ops` | `change-federated-ops-tx.json` |
| `migrate-federated-ops` | `migrate-federated-ops-tx.json` |
| `mint-staging-state` | `mint-staging-state-tx.json` |
| `simple-tx` | `simple-tx.json` |
| `stage-upgrade` | `stage-upgrade-tx.json` |
| `promote-upgrade` | `promote-upgrade-tx.json` |
| `register-gov-auth` | `register-gov-auth-tx.json` |
| `mint-tcnight` | `mint-tcnight-tx.json` |
| `change-terms` | `change-terms-tx.json` |

### Hardcoded blueprint behavior

These commands always use the build blueprint (`useBuild=true`) because they consume one-shot UTxOs — the contracts can't exist in deployed-scripts before these commands run:

- `deploy`
- `deploy-staging-track`
- `deploy-cnight-minting`
- `mint-staging-state` (v2 logic doesn't exist in deployed-scripts until after promotion)

These commands hardcode `useBuild=false` because the contract hash is identical either way:

- `mint-tcnight` (`tcnightMintInfinite` is a fixed test contract)
- `register-gov-auth` (`govAuth`/`stagingGovAuth` are audited immutable contracts)

## 3. Network Mapping

Source: `cli-yargs/lib/types.ts`

| Input pattern | Cardano network | Aiken config section |
|---|---|---|
| `local`, `emulator` | emulator (`null`) | `default` |
| `preview` | `preview` | `preview` |
| `qanet` | `preview` | `qanet` |
| `govnet` | `preview` | `govnet` |
| `devnet-*`, `devnet_*` | `preview` | fallback `preview` |
| `node-dev-*`, `node_dev_*` | `preview` | exact match if configured, otherwise fallback `preview` |
| `preprod` | `preprod` | `preprod` |
| `mainnet` | `mainnet` | `mainnet` |
| unknown | warn + emulator fallback | `default` |

## 4. Environment Variables

| Env var | Source | Required when | Default | Commands |
|---|---|---|---|---|
| `DEPLOYER_ADDRESS` | `cli-yargs/lib/config.ts` | optional | fixed test address | Most tx-building commands |
| `DEPLOY_UTXO_AMOUNT` | `cli-yargs/lib/config.ts` | optional | `20_000_000` | `deploy`, `deploy-staging-track`, `deploy-cnight-minting` |
| `TECH_AUTH_THRESHOLD` | `cli-yargs/lib/config.ts` | optional | `2/3` | `deploy` |
| `COUNCIL_THRESHOLD` | `cli-yargs/lib/config.ts` | optional | `2/3` | `deploy` |
| `COUNCIL_STAGING_THRESHOLD` | `cli-yargs/lib/config.ts` | optional | `0/1` | `deploy` |
| `TECH_AUTH_STAGING_THRESHOLD` | `cli-yargs/lib/config.ts` | optional | `1/2` | `deploy` |
| `TERMS_AND_CONDITIONS_INITIAL_HASH` | `cli-yargs/lib/config.ts` | optional | 64 zeros | `deploy` |
| `TERMS_AND_CONDITIONS_INITIAL_LINK` | `cli-yargs/lib/config.ts` | optional | empty string | `deploy` |
| `SIMPLE_TX_COUNT` | `cli-yargs/lib/config.ts` | optional | `16` | `simple-tx` |
| `SIMPLE_TX_AMOUNT` | `cli-yargs/lib/config.ts` | optional | `20_000_000` | `simple-tx` |
| `TECH_AUTH_SIGNERS` | `cli-yargs/lib/signers.ts` | required for signer-set commands | none | `deploy`, `deploy-staging-track`, `change-tech-auth` |
| `COUNCIL_SIGNERS` | `cli-yargs/lib/signers.ts` | required for signer-set commands | none | `deploy`, `deploy-staging-track`, `change-council` |
| `PERMISSIONED_CANDIDATES` | `cli-yargs/lib/candidates.ts` | required for federated ops | none | `deploy`, `deploy-staging-track`, `change-federated-ops` |
| `TECH_AUTH_PRIVATE_KEYS` | `cli-yargs/lib/signers.ts` | required when signing | none | `change-council`, `change-tech-auth`, `change-federated-ops`, `stage-upgrade`, `promote-upgrade`, `mint-staging-state`, `change-terms` |
| `COUNCIL_PRIVATE_KEYS` | `cli-yargs/lib/signers.ts` | required when signing | none | `change-council`, `change-tech-auth`, `change-federated-ops`, `stage-upgrade`, `promote-upgrade`, `change-terms` |
| `BLOCKFROST_PREVIEW_API_KEY` | `cli-yargs/lib/provider.ts` | blockfrost on preview-mapped envs | none | Most networked commands |
| `BLOCKFROST_PREPROD_API_KEY` | `cli-yargs/lib/provider.ts` | blockfrost on preprod | none | Same |
| `BLOCKFROST_MAINNET_API_KEY` | `cli-yargs/lib/provider.ts` | blockfrost on mainnet | none | Same |
| `KUPO_URL` | `cli-yargs/lib/provider.ts` | `--provider kupmios` | none | Commands using kupmios provider |
| `OGMIOS_URL` | `cli-yargs/lib/provider.ts` | `--provider kupmios` | none | Commands using kupmios provider |
| `SIGNING_PRIVATE_KEY` | default for `--signing-key` | when signing with deployer key | none | `sign-and-submit`, `combine-signatures` |

## 5. Provider Support

| Provider | Status |
|---|---|
| `blockfrost` | Supported (default for all real networks) |
| `kupmios` | Supported (Kupo + Ogmios) |
| `emulator` | Supported (default for `local`/`emulator`) |

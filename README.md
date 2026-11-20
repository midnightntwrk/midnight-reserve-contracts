# Midnight Reserve Contracts

Governance smart contracts for the Midnight network, deployed on Cardano. Manages council membership, technical authority, federated operators, and reserve holdings through upgradable contract patterns.

## Quick Start

Requires [Aiken](https://aiken-lang.org), [just](https://just.systems) and
[Vite+](https://viteplus.dev) (`vp`, which brings Node and pnpm).

```bash
vp install                  # dependencies
just build                  # compile the contracts: plutus.json, contract_blueprint.ts
just check                  # Aiken tests, lint, type check
just test                   # TypeScript tests over the Blaze emulator
just cli --help             # the commands; just cli <command> --help for one
```

Set the environment values the CLI reads in `.env` (`DEPLOYER_ADDRESS`,
`SIGNING_PRIVATE_KEY`, the Blockfrost keys below, and for governance
transactions `TECH_AUTH_PRIVATE_KEYS` and `COUNCIL_PRIVATE_KEYS`).

## Project Structure

```
├── validators/       # On-chain validator entry points (Aiken)
├── lib/              # Shared Aiken helpers
├── cli/              # TypeScript CLI (Effect 4, Blaze) for deployment and transactions
├── tests/            # Blaze emulator integration tests
├── deployed-scripts/ # The record of what is deployed, per environment
├── deployments/      # Transaction files the CLI writes, per environment
├── docs/             # Specifications, one directory per domain
└── plans/            # Implementation plans, one directory per domain
```

## Documentation

- [`docs/architecture/cli.md`](docs/architecture/cli.md) - CLI architecture: flow, services, contract sources, record, layout
- [`docs/architecture/contracts.md`](docs/architecture/contracts.md) - contracts architecture: component pattern, upgrade lifecycle, audit map, hash pinning, known issues
- [`docs/architecture/testing.md`](docs/architecture/testing.md) - test layers, rules, what exists today
- [`docs/governance/runbook.md`](docs/governance/runbook.md) - live deployment and operation with the CLI
- [`docs/governance/validators.md`](docs/governance/validators.md) - validator constraint tags (RF-1, FC-2, ...) for audit
- [`docs/governance/transactions.md`](docs/governance/transactions.md) - transaction construction by operation
- [`docs/governance/upgrade.md`](docs/governance/upgrade.md) - Forever/Two-Stage upgrade flow
- [`docs/governance/transaction-identification.md`](docs/governance/transaction-identification.md) - CIP-20 metadata for governance transactions
- [`AGENTS.md`](AGENTS.md) - development guidelines and the immutable mainnet files

## CLI Commands

The CLI (`cli/`) builds unsigned transactions for offline signing and
writes them under `deployments/<env>/`; only `sign-and-submit` and
`combine-signatures` submit. `just cli <command> --help` lists the flags.

| Command | Description |
|---|---|
| `deploy` | Generate the deployment transactions (`--components` for some; `cnight-minting` only when named) |
| `deploy-staging-track` | Generate the staging forever deployment transactions |
| `change-council` | Update the council members |
| `change-tech-auth` | Update the technical authority members |
| `change-federated-ops` | Update the federated operators |
| `change-terms` | Change the terms and conditions hash and URL |
| `migrate-federated-ops` | Migrate the federated ops datum from v1 to v2 (after the v2 logic is promoted) |
| `mint-staging-state` | Mint the StagingState NFT of a v2 logic |
| `stage-upgrade` | Stage a new logic hash for a two-stage validator |
| `promote-upgrade` | Promote the staged logic to main |
| `register-gov-auth` | Register the main and staging gov auth stake credentials |
| `register-cnight-mint-logic` | Register the cNIGHT mint logic stake credential |
| `run-cnight-mint-mainnet` | Run the cNIGHT mint forever and logic withdrawals |
| `merge-utxos` | Merge two UTxOs at a reserve or ICS forever into one |
| `mint-tcnight` | Mint or burn TCnight tokens (test environments only) |
| `simple-tx` | Pay the deployer (or `--to`) several outputs, e.g. for one-shot UTxOs |
| `info` | Contract addresses and deployment info; `--save` writes the release report |
| `verify` | Check the deployed record against the chain |
| `dust-participants` | Count the registered dust participants |
| `generate-key` | Generate a signing key and its address |
| `sign-and-submit` | Sign a transaction or deployment file with the deployer key and submit it (**submits for real**) |
| `combine-signatures` | Add wallet witnesses to a transaction and submit it (**submits for real**) |
| `build` | Compile the contracts and generate the TypeScript bindings (`--from-deployed` for a deployed environment) |

```bash
just cli change-council -n preview --tx-hash <h> --tx-index <i>
just cli sign-and-submit -n preview deployments/preview/change-council-tx.json
```

See [`docs/governance/runbook.md`](docs/governance/runbook.md) for the
full deployment sequence and
[`docs/architecture/cli.md`](docs/architecture/cli.md) for how a command is
built.

## Environment Configuration

The CLI maps Midnight deployment environments to their underlying Cardano networks:

| Environment | Cardano Network | Notes |
|-------------|-----------------|-------|
| `local`, `emulator` | (emulator) | Local emulator, no real network |
| `preview` | Cardano Preview | Direct mapping |
| `qanet` | Cardano Preview | Midnight QA environment |
| `govnet` | Cardano Preview | Midnight Governance environment |
| `devnet` | Cardano Preview | Midnight Devnet environment |
| `preprod` | Cardano Preprod | Direct mapping |
| `mainnet` | Cardano Mainnet | Direct mapping |

### Using the `--network` Flag

Every command that reads the chain takes `--network` (`-n`) with one of these environments; another name is refused:

```bash
just cli deploy --network preview      # Uses Cardano Preview
just cli deploy --network qanet        # Uses Cardano Preview
just cli deploy --network govnet       # Uses Cardano Preview
just cli deploy --network devnet       # Uses Cardano Preview
just cli deploy --network preprod      # Uses Cardano Preprod
just cli info --network mainnet        # Uses Cardano Mainnet
```

### API Key Environment Variables

Set the appropriate API key for your target Cardano network:

**Blockfrost (default provider on public networks):**
- `BLOCKFROST_PREVIEW_API_KEY` - For preview, qanet, govnet, devnet
- `BLOCKFROST_PREPROD_API_KEY` - For preprod
- `BLOCKFROST_MAINNET_API_KEY` - For mainnet

**Kupmios (self-hosted, use `--provider kupmios`):**
- `KUPO_URL` - Kupo endpoint URL
- `OGMIOS_URL` - Ogmios endpoint URL

### Deployment Directory Structure

Deployment artifacts are organized by environment name under `deployments/`:

```
deployments/
├── preview/           # Preview environment artifacts
├── preprod/           # Preprod environment artifacts
└── <environment>/     # Any other environment
```

Each directory contains transaction files and deployment metadata specific to that environment.

See `cli/config.ts` (`environmentOf`) for the mapping.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Contributors must sign the Midnight Foundation CLA.

## License

Apache 2.0 - see [LICENSE](LICENSE)

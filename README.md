# Midnight Reserve Contracts

Governance smart contracts for the Midnight network, deployed on Cardano. Manages council membership, technical authority, federated operators, and reserve holdings through upgradable contract patterns.

## Quick Start

```bash
# Build contracts (generates plutus.json and contract_blueprint.ts)
just build

# Run on-chain Aiken tests
just check

# Run emulator integration tests (requires build first)
bun test
```

## Project Structure

```
├── validators/       # On-chain validator entry points (Aiken)
├── lib/              # Shared Aiken helpers
├── cli-yargs/        # TypeScript CLI for deployment and transactions
├── tests/            # Blaze emulator integration tests
├── deployments/      # Network-specific deployment artifacts
├── docs/             # Specifications, one directory per domain
└── plans/            # Implementation plans, one directory per domain
```

## Documentation

- [`docs/governance/validators.md`](docs/governance/validators.md) - validator constraint tags (RF-1, FC-2, ...) for audit
- [`docs/governance/transactions.md`](docs/governance/transactions.md) - transaction construction by operation
- [`docs/governance/upgrade.md`](docs/governance/upgrade.md) - Forever/Two-Stage upgrade flow
- [`docs/governance/transaction-identification.md`](docs/governance/transaction-identification.md) - CIP-20 metadata for governance transactions
- [`docs/bridge/`](docs/bridge/) - BEEFY committee bridge (light client, funding pool); plan in [`plans/bridge/`](plans/bridge/)
- [`CLAUDE.md`](CLAUDE.md) - development guidelines, audit boundaries, workspace docs under `.claude/docs/`

## CLI Commands

The CLI (`cli-yargs/`, Blaze Cardano SDK) builds unsigned transactions for
offline signing. `bun run cli-yargs/index.ts <command> --help` lists flags.

| Command | Description |
|---|---|
| `deploy` | Generate initial deployment transactions (one-shot, always uses build blueprint) |
| `deploy-staging-track` | Deploy staging track forever validators |
| `deploy-cnight-minting` | Deploy cNIGHT minting two-stage upgrade contracts |
| `change-council` | Update council multisig state |
| `change-tech-auth` | Update technical authority multisig state |
| `change-federated-ops` | Update federated operators state |
| `change-terms` | Update terms and conditions |
| `migrate-federated-ops` | Migrate federated ops to new logic (always unsigned) |
| `mint-staging-state` | Mint StagingState NFT for a v2 logic contract |
| `mint-tcnight` | Mint or burn TCnight tokens (non-mainnet only) |
| `stage-upgrade` | Stage a v2 logic upgrade |
| `promote-upgrade` | Promote a staged upgrade to main track |
| `register-gov-auth` | Register gov auth scripts as stake credentials |
| `simple-tx` | Generate dust/funding transactions |
| `info` | Display contract addresses and deployment info |
| `verify` | Verify on-chain state against expected configuration |
| `generate-key` | Generate a new signing key |
| `sign-and-submit` | Sign and submit a transaction to the network (**submits for real**) |
| `combine-signatures` | Combine multiple signatures into a signed transaction |
| `build` | Build Aiken contracts |
| `build-from-deployed` | Build contract blueprint from deployed scripts |

```bash
bun run cli-yargs/index.ts deploy --network preview --output deploy-tx.cbor
# Sign with wallet, then:
bun run cli-yargs/index.ts sign-and-submit --tx deploy-tx.cbor --network preview
```

Adding a command: create `cli-yargs/commands/<name>/index.ts` exporting
`command`, `describe`, `builder`, `handler`; register it in `cli-yargs/index.ts`.

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
| (unknown) | (emulator) | Fallback with warning |

### Using the `--network` Flag

All CLI commands accept the `--network` flag with any environment name:

```bash
bun cli deploy --network preview      # Uses Cardano Preview
bun cli deploy --network qanet        # Uses Cardano Preview
bun cli deploy --network govnet       # Uses Cardano Preview
bun cli deploy --network devnet       # Uses Cardano Preview
bun cli deploy --network preprod      # Uses Cardano Preprod
bun cli info --network mainnet        # Uses Cardano Mainnet
```

### API Key Environment Variables

Set the appropriate API key for your target Cardano network:

**Blockfrost (default provider):**
- `BLOCKFROST_PREVIEW_API_KEY` - For preview, qanet, devnet
- `BLOCKFROST_PREPROD_API_KEY` - For preprod
- `BLOCKFROST_MAINNET_API_KEY` - For mainnet

**Maestro (alternative provider, use `--provider maestro`):**
- `MAESTRO_PREVIEW_API_KEY`
- `MAESTRO_PREPROD_API_KEY`
- `MAESTRO_MAINNET_API_KEY`

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

See `cli-yargs/lib/network-mapping.ts` for the implementation details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Contributors must sign the Midnight Foundation CLA.

## License

Apache 2.0 - see [LICENSE](LICENSE)

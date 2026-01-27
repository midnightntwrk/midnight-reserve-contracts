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
├── cli/              # TypeScript CLI for deployment and transactions
├── tests/            # Blaze emulator integration tests
├── deployments/      # Network-specific deployment artifacts
└── spec/             # Detailed constraint specifications
```

## Documentation

- `SPEC.md` - Architecture overview and design patterns
- `AGENTS.md` - Development guidelines and conventions
- `spec/validators.md` - Detailed validator constraint tags

## CLI Commands

The CLI provides tooling for contract deployment and governance operations:

```bash
bun run cli/index.ts deploy           # Deploy contracts
bun run cli/index.ts info             # Query contract state
bun run cli/index.ts change-council   # Propose council change
bun run cli/index.ts stage-upgrade    # Stage contract upgrade
bun run cli/index.ts promote-upgrade  # Promote staged upgrade
```

See `bun run cli/index.ts --help` for all commands.

## Environment Configuration

The CLI maps Midnight deployment environments to their underlying Cardano networks:

| Environment | Cardano Network | Notes |
|-------------|-----------------|-------|
| `local`, `emulator` | (emulator) | Local emulator, no real network |
| `preview` | Cardano Preview | Direct mapping |
| `qanet` | Cardano Preview | Midnight QA environment |
| `govnet` | Cardano Preview | Midnight Governance environment |
| `devnet-*` | Cardano Preview | Any devnet (devnet-01, devnet-02...) |
| `node-dev-*` | Cardano Preview | Node dev envs (node-dev-01, etc.) |
| `preprod` | Cardano Preprod | Direct mapping |
| `mainnet` | Cardano Mainnet | Direct mapping |
| (unknown) | (emulator) | Fallback with warning |

### Using the `--network` Flag

All CLI commands accept the `--network` flag with any environment name:

```bash
bun cli deploy --network preview      # Uses Cardano Preview
bun cli deploy --network qanet        # Uses Cardano Preview
bun cli deploy --network govnet       # Uses Cardano Preview
bun cli deploy --network node-dev-01  # Uses Cardano Preview
bun cli deploy --network preprod      # Uses Cardano Preprod
bun cli info --network mainnet        # Uses Cardano Mainnet
```

### API Key Environment Variables

Set the appropriate API key for your target Cardano network:

**Blockfrost (default provider):**
- `BLOCKFROST_PREVIEW_API_KEY` - For preview, qanet, devnet-*, node-dev-*
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

See `cli/lib/network-mapping.ts` for the implementation details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Contributors must sign the Midnight Foundation CLA.

## License

Apache 2.0 - see [LICENSE](LICENSE)

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Contributors must sign the Midnight Foundation CLA.

## License

Apache 2.0 - see [LICENSE](LICENSE)

# Midnight Reserve Contracts

Governance smart contracts for the Midnight network, deployed on Cardano. Manages council membership, technical authority, federated operators, and reserve holdings through upgradable contract patterns.

## Quick Start

```bash
# Build contracts (generates plutus.json and contract_blueprint.ts)
just build

# Run on-chain Aiken tests
just check

# Run the tests locally: emulator only, no network, no .env (requires build first; this is what CI runs)
bun test

# Also run the chain-facing tests against preview with the .env values (reads only)
just test-preview
```

## Project Structure

```
├── validators/       # On-chain validator entry points (Aiken)
├── lib/              # Shared Aiken helpers
├── cli/              # TypeScript CLI for deployment and transactions
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
- [`docs/governance/live-deployment.md`](docs/governance/live-deployment.md) - live deployment runbook: command order, signing, multi-party witnesses
- [`docs/bridge/`](docs/bridge/) - BEEFY committee bridge (light client, funding pool); plan in [`plans/bridge/`](plans/bridge/)
- [`CLAUDE.md`](CLAUDE.md) - development guidelines and audit boundaries

## CLI Commands

The CLI (`cli/`, Blaze Cardano SDK) builds transactions into
`deployments/<network>/`. Governance commands sign with the keys in `.env`
by default; `--no-sign` writes an unsigned transaction for offline signing.
`bun run cli/index.ts <command> --help` lists flags.

| Command | Description |
|---|---|
| `deploy` | Generate initial deployment transactions (one-shot, always uses build blueprint); the committee bridge components only when `--components` names them |
| `deploy-staging-track` | Deploy staging track forever validators |
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
| `register-cnight-mint-logic` | Register the cNIGHT mint logic script as a stake credential |
| `merge-utxos` | Merge two value-holding UTxOs at a reserve or ICS forever validator |
| `simple-tx` | Generate dust/funding transactions |
| `info` | Display contract addresses and deployment info |
| `verify` | Verify the deployed record (`deployed-scripts/<env>/`) against the unspent outputs on chain |
| `dust-participants` | Count registered dust participants |
| `generate-key` | Generate a new signing key |
| `sign-and-submit` | Sign and submit a transaction to the network (**submits for real**) |
| `combine-signatures` | Merge external witnesses into one transaction and submit it (**submits for real**) |
| `build` | Build Aiken contracts; `--from-deployed [--components <list>]` compiles against the deployed hashes |
| `bridge-info` | Show the committee bridge: light-client state, running logic, threshold and fee cap, pool, reference scripts |
| `bridge-topup` | Pay `--lovelace` to the committee bridge pool |
| `bridge-update` | Build a light-client update from a `BridgeUpdate` JSON file; `--funded`: the pool pays a handover's fee up to the cap |
| `bridge-set-fee` | Change the committee bridge fee cap under Council + Tech Auth |
| `bridge-set-threshold` | Change the committee bridge signer threshold under Council + Tech Auth |

```bash
bun run cli/index.ts deploy --network preview
# Writes deployments/preview/deployment-transactions.json; sign with SIGNING_PRIVATE_KEY and submit:
bun run cli/index.ts sign-and-submit deployments/preview/deployment-transactions.json --network preview
```

Adding a command: create `cli/commands/<name>.ts` with an `@effect/cli`
`Command.make` over its options: the shared ones from `cli/options.ts` and
its own, each text value parsed at the boundary (`parsedText`). Its handler
is the program. Pipe it through the `cli/run.ts` helper that gives it the
services it reads: `withServices(source)` (Settings, Blueprint and Provider
over the `"deployed"` or `"build"` blueprint), `withServicesUseBuild` (the
same, with the blueprint from `--use-build`) or `withProvider` (Settings
and Provider); a command that reads none of them (`build`,
`generate-key`) takes no helper. Add it to the root in
`cli/index.ts`. The program takes a typed input record and lives in the
domain folder that owns it (`cli/governance/`, `cli/chain/`,
`cli/report/`, ...).

## Environment Configuration

The CLI maps Midnight deployment environments to their underlying Cardano networks:

| Environment | Cardano Network | Notes |
|-------------|-----------------|-------|
| `local` | (local node) | Local Kupo/Ogmios node; default provider `kupmios` |
| `emulator` | (emulator) | In-memory emulator, no real network |
| `preview` | Cardano Preview | Direct mapping |
| `qanet` | Cardano Preview | Midnight QA environment |
| `govnet` | Cardano Preview | Midnight Governance environment |
| `devnet` | Cardano Preview | Midnight Devnet environment |
| `preprod` | Cardano Preprod | Direct mapping |
| `mainnet` | Cardano Mainnet | Direct mapping |

Any other name is refused before the command runs: `Expected one of the following cases: local, emulator, preview, qanet, govnet, devnet, preprod, mainnet`. The names are case-sensitive.

### Using the `--network` Flag

Every command except `build` and `mint-tcnight` accepts the `--network` flag with any environment name above (default: `local`). `build` takes an aiken.toml profile instead (`default`, the vanilla build, or a name above other than `emulator`); `mint-tcnight` takes every name but `mainnet`, since TCnight exists only on test environments:

```bash
bun cli deploy --network preview      # Uses Cardano Preview
bun cli deploy --network qanet        # Uses Cardano Preview
bun cli deploy --network govnet       # Uses Cardano Preview
bun cli deploy --network devnet       # Uses Cardano Preview
bun cli verify --network preprod      # Uses Cardano Preprod
bun cli info --network mainnet        # Uses Cardano Mainnet
```

### API Key Environment Variables

Set the appropriate API key for your target Cardano network:

**Blockfrost (default provider on public networks):**
- `BLOCKFROST_PREVIEW_API_KEY` - For preview, qanet, govnet, devnet
- `BLOCKFROST_PREPROD_API_KEY` - For preprod
- `BLOCKFROST_MAINNET_API_KEY` - For mainnet

**Kupmios (self-hosted, default for `local`; elsewhere use `--provider kupmios`):**
- `KUPO_URL` - Kupo endpoint URL
- `OGMIOS_URL` - Ogmios endpoint URL

### Logs

Diagnostics (a retried provider call, a failed local UPLC run) go to stderr, pretty on a terminal and logfmt otherwise; the command's own output goes to stdout. `LOG_LEVEL` (the environment or `.env`) sets the minimum level: `All`, `Trace`, `Debug`, `Info` (the default), `Warning`, `Error`, `Fatal` or `None`, in any case. A bad value fails the command before it runs. `--log-level <level>` on a command sets it for that run and wins over `LOG_LEVEL`:

```bash
LOG_LEVEL=debug bun cli verify --network preview
bun cli verify --network preview --log-level warning
```

### Deployment Directory Structure

Deployment artifacts are organized by environment name under `deployments/`:

```
deployments/
├── preview/           # Preview environment artifacts
├── preprod/           # Preprod environment artifacts
└── <environment>/     # Any other environment
```

Each directory contains transaction files and deployment metadata specific to that environment.

See `cli/config/network-mapping.ts` for the implementation details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Contributors must sign the Midnight Foundation CLA.

## License

Apache 2.0 - see [LICENSE](LICENSE)

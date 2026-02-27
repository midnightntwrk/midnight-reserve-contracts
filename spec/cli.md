# CLI Architecture

> **Command-organized specification for Midnight Reserve CLI.** Documents command structure, patterns, and extension points.

---

## Overview

The CLI (`cli-yargs/`) provides TypeScript tooling for contract deployment and governance operations. Built on Blaze Cardano SDK.

## Directory Structure

```
cli-yargs/
├── index.ts              # Entry point, command routing
├── commands/             # Individual command implementations (each in its own directory)
│   ├── deploy/             # Deploy all contracts
│   ├── change-council/     # Council membership changes
│   ├── change-tech-auth/   # Tech authority changes
│   ├── change-federated-ops/ # Federated ops changes
│   ├── stage-upgrade/      # Stage contract upgrades
│   ├── promote-upgrade/    # Promote staged upgrades
│   ├── sign-and-submit/    # Sign and submit transactions
│   ├── combine-signatures/ # Combine wallet signatures
│   ├── info/               # Query contract state
│   ├── mint-tcnight/       # Mint/burn TCnight tokens
│   ├── register-gov-auth/  # Register auth stake credentials
│   ├── generate-key/       # Generate signing keys
│   └── simple-tx/          # Simple transaction helper
└── lib/                  # Shared utilities
```

## Command Pattern

Each command follows a consistent pattern:

```typescript
// cli/commands/example.ts
export async function exampleCommand(args: ExampleArgs): Promise<void> {
  // 1. Initialize Blaze provider for network
  const blaze = await initBlaze(args.network);

  // 2. Query current state
  const state = await queryContractState(blaze);

  // 3. Build transaction
  const tx = await blaze.newTransaction()
    .addInput(...)
    .addOutput(...)
    .complete();

  // 4. Output transaction (or submit if sign-and-submit)
  outputTransaction(tx, args.outputPath);
}
```

## Network Support

| Network | Use Case |
|---------|----------|
| `local` | Local development with emulator |
| `preview` | Cardano preview testnet |
| `preprod` | Cardano pre-production testnet |
| `mainnet` | Production (requires explicit confirmation) |
| `govnet` | Governance network testing |
| `qanet` | QA environment |
| `devnet-*` | Development environments |
| `node-dev-*` | Node development environments |

## Key Commands

### deploy

Deploys all governance contracts in correct dependency order:
1. Threshold validators (governance thresholds)
2. Two-stage upgrade contracts (for each domain)
3. Forever contracts (for each domain)
4. Logic contract registrations

### stage-upgrade / promote-upgrade

Two-phase upgrade process:
1. `stage-upgrade` - Write new logic hash to staging datum
2. `promote-upgrade` - Copy staged logic to main datum

Both require Council + Tech Authority multisig authorization.

### change-council / change-tech-auth / change-federated-ops

Membership change operations:
1. Build transaction spending forever UTxO
2. Include new membership datum
3. Require multisig witnesses from both Council and Tech Authority

### sign-and-submit

**DANGEROUS**: Signs with local key and submits to network. Only use with explicit permission.

## Transaction Output

Commands output unsigned transactions in CBOR format for offline signing:

```bash
bun run cli deploy --network preview --output deploy-tx.cbor
# Sign with wallet
bun run cli sign-and-submit --tx deploy-tx.cbor --network preview
```

## Adding New Commands

1. Create `cli-yargs/commands/new-command/index.ts`
2. Export command, describe, builder, handler following command pattern
3. Add command routing in `cli-yargs/index.ts`
4. Document in this file

## Configuration

Network-specific configuration in `deployments/<network>/`:
- `config.json` - One-shot UTxOs, validator hashes
- `plutus.json` - Compiled validator scripts (network-specific)

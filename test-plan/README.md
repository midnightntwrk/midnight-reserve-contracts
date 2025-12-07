# Midnight Governance Test Plan CLI

Interactive CLI tool for testing the Midnight governance contracts according to the documented testing plan.

## Structure

```
test-plan/
├── index.ts              # Main CLI entry point with sprinkles menu
├── lib/
│   ├── types.ts          # Core type definitions
│   ├── provider.ts       # Abstraction for emulator/testnet/mainnet
│   ├── state-manager.ts  # Test run state persistence
│   └── contracts.ts      # Contract instances manager
├── tests/
│   ├── index.ts          # Test category definitions
│   └── deployment.ts     # Deployment tests
└── utils/
    └── reporting.ts      # Test result formatting and reporting
```

## Usage

Run the interactive menu:

```bash
bun run test-plan/index.ts
```

Or use npm scripts:

```bash
cd test-plan
bun test                 # Launch interactive menu
bun test:deploy          # Run deployment tests only
```

## Test Modes

- **emulator**: Tests run against Blaze emulator (default, no external dependencies)
- **testnet**: Tests run against Cardano testnet (requires network provider setup)
- **mainnet**: Tests run against Cardano mainnet (requires network provider setup)

## Test State

Test runs are automatically persisted to `.config/test-runs/`. Each run has a unique ID and tracks:

- Deployment information (tx hashes, UTxOs, script hashes)
- Test results (pass/fail, errors, timing)
- Test progression (which tests have passed, prerequisites)

You can resume or review past test runs from the CLI menu.

## Adding Tests

Tests are defined in `tests/` and follow the `TestDefinition` interface:

```typescript
{
  id: "unique-test-id",
  name: "Human readable name",
  description: "What this test does",
  prerequisites: ["other-test-id"],  // Optional
  execute: async (ctx: TestContext) => {
    // Test implementation
    return result;
  }
}
```

The `TestContext` provides:
- `provider`: Access to Blaze instances (works with emulator or real networks)
- `state`: Current test run state (deployments, results, metadata)

## Provider Abstraction

The provider abstraction allows tests to work seamlessly across different environments:

```typescript
const blaze = await ctx.provider.getBlaze("wallet-id");
// Works in both emulator and on-chain
```

This design avoids coupling tests to the emulator, making it easy to run the same tests against real networks later.

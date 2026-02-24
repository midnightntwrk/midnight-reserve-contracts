# Architecture & Workspace Structure

```
validators/                    # Aiken entry point validators
├── reserve.ak                   # Reserve forever/two-stage/logic
├── permissioned.ak              # Council, Tech Auth, Federated Ops (forever/two-stage/logic)
├── registered_candidate.ak      # Registered candidate validators
├── committee_bridge.ak          # BEEFY bridge validators
├── illiquid_circulation_supply.ak # ICS forever/two-stage/logic
├── terms_and_conditions.ak      # T&C forever/two-stage/logic
├── thresholds.ak                # Multisig threshold validators
├── gov_auth.ak                  # Main/staging governance auth
├── cnight_minting.ak            # Dynamic mint validator (policy lives in separate repo)
├── cnight_generates_dust.ak     # Dust mapping validator
└── validator_types.ak           # Shared type definitions

lib/                           # Shared Aiken helper modules
├── auth/                        # Governance authentication
├── forever/                     # Forever contract pattern
├── upgradable/                  # Two-stage upgrade logic
├── logic/                       # Logic contract implementations
├── multisig/                    # Multisig structure validation
├── bridge/                      # BEEFY bridge codec
└── utils.ak                     # Common utilities

cli/                           # TypeScript CLI (Blaze SDK)
tests/                         # Blaze emulator integration tests
deployments/                   # Network-specific artifacts
```

## Key Principles

- Validators hold billions - no shortcuts on validation logic
- CLI is dev tooling - convenience tradeoffs acceptable
- Forever/Two-Stage/Logic pattern for all governance domains
- NFT-gated state prevents UTXO duplication

## Crate-Specific Commands

```bash
# Build validators
aiken build

# Run Aiken tests
aiken check

# Run single emulator test
bun test tests/basic_deploy.test.ts
```

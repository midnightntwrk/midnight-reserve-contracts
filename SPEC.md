# Midnight Reserve Contracts Specification

> **This spec is the source of truth.** Keep it updated as you make changes. If it gets too large, split into sub-files.

---

## Project Architecture

### What is Midnight Reserve?

Midnight Reserve is **governance smart contracts** for the Midnight blockchain, deployed on Cardano. It provides:
- Governance bodies: Council, Technical Authority, Federated Operators
- Two-stage upgradable logic for all governance contracts
- Reserve management for CNIGHT/NIGHT token holdings
- Threshold configuration for multisig quorum requirements
- TypeScript CLI for deployment and governance operations

### Workspace Structure

```
midnight-reserve-contracts/
├── validators/                    # Aiken entry point validators
│   ├── reserve.ak                   # Reserve forever/two-stage/logic
│   ├── permissioned.ak              # Council, Tech Auth, Federated Ops (forever/two-stage/logic)
│   ├── registered_candidate.ak      # Registered candidate validators
│   ├── committee_bridge.ak          # BEEFY bridge validators
│   ├── illiquid_circulation_supply.ak # ICS forever/two-stage/logic
│   ├── terms_and_conditions.ak      # T&C forever/two-stage/logic
│   ├── thresholds.ak                # Multisig threshold validators
│   ├── gov_auth.ak                  # Main/staging governance auth
│   ├── cnight_minting.ak            # Dynamic mint validator (policy lives in separate repo)
│   ├── cnight_generates_dust.ak     # Dust mapping validator
│   └── validator_types.ak           # Shared type definitions
├── lib/                           # Shared Aiken helper modules
│   ├── auth/                        # Governance authentication (main + staging)
│   ├── forever/                     # Forever contract (immutable proxy) pattern
│   ├── upgradable/                  # Two-stage upgrade logic
│   ├── logic/                       # Logic contract implementations
│   ├── multisig/                    # Multisig structure validation
│   ├── bridge/                      # BEEFY bridge codec and validation
│   └── utils.ak                     # Common utilities
├── cli/                           # TypeScript CLI
│   ├── index.ts                     # Entry point, command routing
│   ├── commands/                    # Command implementations
│   │   ├── deploy.ts
│   │   ├── change-council.ts
│   │   ├── change-tech-auth.ts
│   │   ├── change-federated-ops.ts
│   │   ├── stage-upgrade.ts
│   │   ├── promote-upgrade.ts
│   │   ├── sign-and-submit.ts
│   │   ├── combine-signatures.ts
│   │   ├── info.ts
│   │   └── ...
│   ├── lib/                         # Blaze SDK helpers
│   └── utils/                       # Validation, output helpers
├── tests/                         # Blaze emulator integration tests
├── deployments/                   # Network-specific artifacts
└── spec/                          # Detailed specifications
```

### Module Dependencies

```
validators/*.ak (entry points)
    └─→ lib/*/ (shared helpers)
            ├─→ lib/forever/
            ├─→ lib/upgradable/
            ├─→ lib/logic/
            ├─→ lib/multisig/
            ├─→ lib/auth/
            └─→ lib/bridge/

cli/ (TypeScript)
    └─→ @blaze-cardano/* (SDK)
            ├─→ contract_blueprint.ts (generated bindings)
            └─→ plutus.json (compiled scripts)
```

### Design Philosophy

**Production security on-chain, developer convenience for tooling.**

| Aspect | Approach |
|--------|----------|
| On-chain security | No shortcuts - every constraint matters, code holds billions |
| CLI/tooling | Dev-only, convenience tradeoffs OK |
| Upgradability | Two-stage pattern with council + tech authority approval |

### Architectural Patterns

The core pattern enabling upgradable governance contracts:

```
┌─────────────────────────────────────────────────────────────┐
│                    Forever Contract (Proxy)                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Look up two-stage "main" NFT via reference input  │  │
│  │ 2. Extract logic hash from datum                     │  │
│  │ 3. Require withdrawal of that logic script           │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Two-Stage Upgrade Contract              │  │
│  │  "main" NFT: current logic + auth hashes             │  │
│  │  "staging" NFT: proposed logic + auth hashes         │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Logic Contract (Withdraw)               │  │
│  │  Actual validation rules executed via withdrawal     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Patterns Used:**

| Pattern | Implementation | Benefit |
|---------|---------------|---------|
| **Proxy Pattern** | Forever contracts delegate to logic hash | Immutable address, swappable logic |
| **Two-Stage Upgrade** | Stage change, then promote | Safe upgrades with dual authorization |
| **Withdrawal Validation** | Logic runs via withdraw scripts | Flexible logic swaps |
| **NFT-Gated State** | Each UTXO carries unique NFT | Prevents state duplication |

**Key Design Decisions:**

1. **Forever contracts are immutable proxies** - They only delegate to whatever logic hash is stored in the two-stage datum
2. **Two-stage enables safe upgrades** - Stage a change, then promote it (requires dual authorization)
3. **Logic runs via withdrawal** - Actual validation happens in withdraw scripts, enabling flexible logic swaps
4. **NFT-gated state** - Each state UTXO carries a unique NFT to prevent duplication
5. **Dual authorization required** - Both Council and Technical Authority must approve all governance changes

### Contract Families

Each governance domain follows the same three-contract pattern:

| Domain | Forever | Two-Stage | Logic |
|--------|---------|-----------|-------|
| Reserve | `reserve_forever` | `reserve_two_stage_upgrade` | `reserve_logic` |
| Council | `council_forever` | `council_two_stage_upgrade` | `council_logic` |
| Tech Authority | `tech_auth_forever` | `tech_auth_two_stage_upgrade` | `tech_auth_logic` |
| Federated Ops | `federated_ops_forever` | `federated_ops_two_stage_upgrade` | `federated_ops_logic` |
| ICS | `ics_forever` | `ics_two_stage_upgrade` | `ics_logic` |
| Committee Bridge | `committee_bridge_forever` | `committee_bridge_two_stage_upgrade` | `committee_bridge_logic` |

### Governance Actors

| Actor | Role |
|-------|------|
| **Council** | Authorizes upgrades, member changes, threshold changes |
| **Technical Authority** | Co-authorizes with Council for all governance operations |
| **Federated Operators** | List of keys permissioned to produce blocks on Midnight (separate blockchain) |

Both Council and Technical Authority must approve any changes. Federated Operators is a permissioned registry without governance authority.

### Threshold Validators

Governance thresholds (multisig quorum fractions) are stored in separate validators:
- `main_gov_threshold` - Main governance operations
- `staging_gov_threshold` - Staging area for threshold changes
- `main_council_update_threshold` - Council membership changes
- `main_tech_auth_update_threshold` - Tech authority membership changes
- `main_federated_ops_update_threshold` - Federated ops membership changes
- `beefy_signer_threshold` - BEEFY protocol signer threshold

---

## Reference Projects

Architecture patterns derived from well-established open source projects:

| Project | Use Case |
|---------|----------|
| [Blaze Cardano](https://github.com/butaneprotocol/blaze-cardano) | Transaction construction SDK, emulator testing |
| [Aiken stdlib](https://github.com/aiken-lang/stdlib) | On-chain patterns, standard library |

---

## Detailed Documentation

- [Validator Constraints](spec/validators.md) - Constraint tags (RF-1, FC-2, etc.) for audit
- [Transaction Specifications](spec/transactions.md) - Transaction construction by operation type
- [CLI Architecture](spec/cli.md) - CLI command architecture and patterns
- [Upgrade Process](spec/upgrade.md) - Forever/Two-Stage upgrade flow details

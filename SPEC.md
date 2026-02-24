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
│   ├── reserve.ak                   # Reserve forever/two-stage/logic (audited)
│   ├── reserve_v2.ak                # V2 reserve logic
│   ├── permissioned.ak              # Council, Tech Auth, Federated Ops (audited)
│   ├── permissioned_v2.ak           # V2 council, tech auth, federated ops logic
│   ├── registered_candidate.ak      # Registered candidate validators
│   ├── committee_bridge.ak          # BEEFY bridge validators
│   ├── illiquid_circulation_supply.ak # ICS forever/two-stage/logic (audited)
│   ├── illiquid_circulation_supply_v2.ak # V2 ICS logic
│   ├── terms_and_conditions.ak      # T&C forever/two-stage/logic (audited)
│   ├── terms_and_conditions_v2.ak   # V2 T&C logic
│   ├── staging_permissioned.ak      # Staging forever for council/tech-auth/federated-ops
│   ├── staging_reserve_ics.ak       # Staging forever for reserve/ICS
│   ├── staging_tandc.ak             # Staging forever for T&C
│   ├── thresholds.ak                # Multisig threshold validators
│   ├── gov_auth.ak                  # Main/staging governance auth
│   ├── cnight_minting.ak            # Dynamic mint validator (policy lives in separate repo)
│   ├── cnight_generates_dust.ak     # Dust mapping validator
│   └── validator_types.ak           # Shared type definitions
├── lib/                           # Shared Aiken helper modules
│   ├── auth/                        # Governance authentication (main + staging)
│   ├── forever/                     # Forever contract (immutable proxy) pattern
│   │   └── types_v2.ak               # FederatedOpsV2 type
│   ├── upgradable/                  # Two-stage upgrade logic
│   ├── logic/                       # Logic contract implementations
│   │   ├── types_v2.ak                # LogicRedeemer type (Normal | Migrate)
│   │   └── next_version.ak           # V2 logic functions
│   ├── multisig/                    # Multisig structure validation
│   ├── bridge/                      # BEEFY bridge codec and validation
│   └── utils.ak                     # Common utilities
├── cli/                           # TypeScript CLI
│   ├── index.ts                     # Entry point, command routing
│   ├── commands/                    # Command implementations
│   │   ├── deploy.ts
│   │   ├── deploy-staging-track.ts
│   │   ├── change-council.ts
│   │   ├── change-tech-auth.ts
│   │   ├── change-federated-ops.ts
│   │   ├── stage-upgrade.ts
│   │   ├── promote-upgrade.ts
│   │   ├── mint-staging-state.ts      # Mint StagingState NFT for v2 logic
│   │   ├── migrate-federated-ops.ts   # Migrate federated ops datum v1→v2
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

### Audited Commit Boundary

All original `.ak` files (without `_v2` suffix) match audited commit `ca38d87` exactly. These files are immutable and must not be modified.

V2 files (`*_v2.ak`) contain new logic and are **not** part of the v1 audit scope. All new on-chain code goes in `_v2` files.

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

### Migrate Redeemer Pattern

V2 logic validators use a `LogicRedeemer` type that supports two modes:

| Variant | Purpose | Multisig Required? |
|---------|---------|-------------------|
| `Normal(Data)` | Standard multisig-validated state change | Yes |
| `Migrate` | One-time datum upgrade from v1 to v2 | No |

The `Migrate` redeemer bypasses multisig validation but is gated by `logic_round` checks, ensuring each migration can only happen once.

**Transformation Rules by Contract:**

| Contract | Input Type | Output Type | logic_round | Preserved Fields | New Fields |
|----------|-----------|-------------|-------------|-----------------|------------|
| Council | `Versioned<Multisig>` | `Versioned<Multisig>` | 0 → 1 | Multisig data (exact) | None |
| Tech Authority | `Versioned<Multisig>` | `Versioned<Multisig>` | 0 → 1 | Multisig data (exact) | None |
| Federated Ops | `FederatedOps` | `FederatedOpsV2` | 1 → 2 | data, appendix | message = "" |
| Terms & Conditions | `Versioned<T&C>` | `Versioned<T&C>` | 0 → 1 | T&C data (exact) | None |

### Contract Families

Each governance domain follows the same three-contract pattern (plus optional v2 logic):

| Domain | Forever | Two-Stage | Logic (v1) | Logic (v2) |
|--------|---------|-----------|------------|------------|
| Reserve | `reserve_forever` | `reserve_two_stage_upgrade` | `reserve_logic` | `reserve_logic_v2` |
| Council | `council_forever` | `council_two_stage_upgrade` | `council_logic` | `council_logic_v2` |
| Tech Authority | `tech_auth_forever` | `tech_auth_two_stage_upgrade` | `tech_auth_logic` | `tech_auth_logic_v2` |
| Federated Ops | `federated_ops_forever` | `federated_ops_two_stage_upgrade` | `federated_ops_logic` | `federated_ops_logic_v2` |
| ICS | `ics_forever` | `ics_two_stage_upgrade` | `ics_logic` | `ics_logic_v2` |
| Terms & Conditions | `terms_and_conditions_forever` | `terms_and_conditions_two_stage_upgrade` | `terms_and_conditions_logic` | `terms_and_conditions_logic_v2` |
| Committee Bridge | `committee_bridge_forever` | `committee_bridge_two_stage_upgrade` | `committee_bridge_logic` | — |

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

### Deployment Environments

Contracts are deployed to multiple environments on Cardano networks. Each environment has its own configuration section in `aiken.toml` and deployment artifacts in `deployments/`.

| Environment | Cardano Network | Purpose |
|-------------|----------------|---------|
| `default` | (emulator) | Local emulator / default config |
| `preview` | Preview | Cardano Preview testnet |
| `qanet` | Preview | Midnight QA environment |
| `govnet` | Preview | Midnight Governance environment |
| `node-dev-01` | Preview | Node development environment 1 |
| `node-dev-2` | Preview | Node development environment 2 |

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

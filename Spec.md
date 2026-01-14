# Midnight Reserve Contracts Specification

> **Source of truth for architecture.** Keep updated as you make changes. For validator constraints, see `spec/validators.md`.

---

## What Are These Contracts?

Midnight governance smart contracts deployed on Cardano. They manage:
- **Governance bodies**: Council, Technical Authority, Federated Operators
- **Upgrade mechanisms**: Two-stage upgradable logic for all governance contracts
- **Reserve management**: CNIGHT/NIGHT token reserve holdings
- **Threshold configuration**: Multisig quorum requirements

## Design Philosophy

**Production security on-chain, developer convenience for tooling.**

| Aspect | Approach |
|--------|----------|
| On-chain security | No shortcuts - every constraint matters, code holds billions |
| CLI/tooling | Dev-only, convenience tradeoffs OK |
| Upgradability | Two-stage pattern with council + tech authority approval |

## Governance Actors

| Actor | Role |
|-------|------|
| **Council** | Authorizes upgrades, member changes, threshold changes |
| **Technical Authority** | Co-authorizes with Council for all governance operations |
| **Federated Operators** | List of keys permissioned to produce blocks on Midnight (separate blockchain) |

Both Council and Technical Authority must approve any changes. Federated Operators is a permissioned registry without governance authority.

---

## Forever + Two-Stage Upgrade Pattern

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

**Key Design Decisions:**

1. **Forever contracts are immutable proxies** - They only delegate to whatever logic hash is stored in the two-stage datum
2. **Two-stage enables safe upgrades** - Stage a change, then promote it (requires dual authorization)
3. **Logic runs via withdrawal** - Actual validation happens in withdraw scripts, enabling flexible logic swaps
4. **NFT-gated state** - Each state UTXO carries a unique NFT to prevent duplication

## Contract Families

Each governance domain follows the same three-contract pattern:

| Domain | Forever | Two-Stage | Logic |
|--------|---------|-----------|-------|
| Reserve | `reserve_forever` | `reserve_two_stage_upgrade` | `reserve_logic` |
| Council | `council_forever` | `council_two_stage_upgrade` | `council_logic` |
| Tech Authority | `tech_auth_forever` | `tech_auth_two_stage_upgrade` | `tech_auth_logic` |
| Federated Ops | `federated_ops_forever` | `federated_ops_two_stage_upgrade` | `federated_ops_logic` |
| ICS | `ics_forever` | `ics_two_stage_upgrade` | `ics_logic` |

## Threshold Validators

Governance thresholds (multisig quorum fractions) are stored in separate validators:
- `main_gov_threshold` - Main governance operations
- `staging_gov_threshold` - Staging area for threshold changes
- `main_council_update_threshold` - Council membership changes
- `main_tech_auth_update_threshold` - Tech authority membership changes
- `main_federated_ops_update_threshold` - Federated ops membership changes
- `beefy_signer_threshold` - BEEFY protocol signer threshold

---

## Data Directory

| Path | Purpose |
|------|---------|
| `validators/*.ak` | On-chain validator entry points |
| `lib/<domain>/` | Shared Aiken helpers |
| `cli/` | TypeScript CLI for deployment and transactions |
| `tests/*.test.ts` | Blaze emulator integration tests |
| `deployments/<network>/` | Network-specific deployment artifacts |
| `spec/` | Detailed constraint specifications |

---

## CLI Overview

The CLI (`cli/`) provides dev tooling for contract deployment and governance operations:

| Command | Purpose |
|---------|---------|
| `deploy` | Deploy all contracts to a network |
| `change-council` | Propose council membership change |
| `change-tech-auth` | Propose tech authority membership change |
| `change-federated-ops` | Propose federated ops membership change |
| `stage-upgrade` | Stage a contract upgrade |
| `promote-upgrade` | Promote staged upgrade to main |
| `sign-and-submit` | Sign and submit a transaction (**dangerous**) |
| `info` | Query current contract state |

---

## Key Files

| File | Purpose |
|------|---------|
| `aiken.toml` | Aiken project configuration with all validator hashes |
| `plutus.json` | Compiled Plutus scripts |
| `contract_blueprint.ts` | TypeScript bindings for contract interaction |
| `spec/validators.md` | Detailed constraint tags (RF-1, FC-2, etc.) |

# Upgrade Process Specification

> **Detailed specification for the Forever + Two-Stage upgrade pattern.** Documents the upgrade flow, state transitions, and authorization requirements.

---

## Overview

The Forever/Two-Stage/Logic upgrade architecture is reused across multiple governance domains, including Reserve, Council, Tech Auth, Federated Ops, ICS, and the BEEFY-backed committee bridge.

The shared statements in this document describe upgrade mechanics only. They do not define any domain's runtime validation semantics, including the committee-bridge proof-verification boundary.

The common three-contract pattern is:
1. **Forever Contract** - Immutable proxy that delegates to current logic
2. **Two-Stage Contract** - Holds upgrade state with staging area
3. **Logic Contract** - Actual validation rules (swappable)

## Contract Relationship

```
┌─────────────────────────────────────────────────────────┐
│                   Forever Contract                       │
│  - Immutable (deployed once, never changes)             │
│  - Looks up current logic hash from two-stage datum     │
│  - Requires withdrawal of logic script to validate      │
└───────────────────────────┬─────────────────────────────┘
                            │ reads
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Two-Stage Upgrade Contract                  │
│  "main" NFT: {logic, mitigation_logic, auth, mit_auth}  │
│  "staging" NFT: {logic, mitigation_logic, auth, mit_auth}│
│  - State changes require Council + TechAuth approval    │
└───────────────────────────┬─────────────────────────────┘
                            │ hash reference
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   Logic Contract                         │
│  - Registered as stake credential (withdrawal-based)    │
│  - Contains actual validation rules                     │
│  - Can be replaced without touching forever contract    │
└─────────────────────────────────────────────────────────┘
```

## UpgradeState Datum

```
UpgradeState = [
  logic_hash: ByteArray(28),        // Current logic script hash
  mitigation_logic: ByteArray,      // Empty or 28-byte mitigation logic hash
  gov_auth: ByteArray(28),          // Governance auth script hash
  mitigation_auth: ByteArray,       // Empty or 28-byte mitigation auth hash
  round: Int,                       // Version counter
  logic_round: Int                  // Incremented on each stage/promote
]
```

## Upgrade Fields

| Field | Purpose | Transition Rules |
|-------|---------|------------------|
| `logic_hash` | Main validation logic | Can be updated any time |
| `mitigation_logic` | Emergency fallback logic | Can only transition from empty ONCE |
| `gov_auth` | Authorization script | Can be updated any time |
| `mitigation_auth` | Emergency auth script | Can only transition from empty ONCE |

## Upgrade Flow

### Phase 1: Stage

Stage a new logic hash to the staging datum.

```
Inputs:
  - staging UTxO (spent)

Reference Inputs:
  - main UTxO (to read current state)
  - staging_gov_threshold (for auth requirements)
  - council_forever, tech_auth_forever (for multisig validation)

Outputs:
  - Updated staging UTxO with new logic_hash in UpgradeState

Withdrawals:
  - staging_gov_auth (validates Council + TechAuth approval)

Minting:
  - Council witness token (native multisig)
  - TechAuth witness token (native multisig)
```

**Constraints (TSG series):**
- TSG-1: Redeemer script hash must be 28 bytes
- TSG-2: Staging datum must be inline
- TSG-3: Referenced main datum must be inline
- TSG-6: Withdrawals must include staging auth pair OR main auth pair
- TSG-7: Cannot set mitigation_logic if main already has one
- TSG-8: Cannot set mitigation_auth if main already has one

### Phase 2: Promote

Promote the staged logic to main.

```
Inputs:
  - main UTxO (spent)

Reference Inputs:
  - staging UTxO (to read staged logic hash)
  - main_gov_threshold (for auth requirements)
  - council_forever, tech_auth_forever (for multisig validation)

Outputs:
  - Updated main UTxO with logic_hash copied from staging

Withdrawals:
  - main_gov_auth (validates Council + TechAuth approval)

Minting:
  - Council witness token (native multisig)
  - TechAuth witness token (native multisig)
```

**Constraints (TM series):**
- TM-1: Spending datum must be inline
- TM-2: Referenced staging datum must be inline
- TM-4: Withdrawals must include both auth credentials from main datum
- TM-5: Staging datum provides next logic hash
- TM-7: Mitigation logic may only transition from empty once
- TM-9: Mitigation auth may only transition from empty once

## Authorization Flow

```
                    Stage Upgrade
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
staging_gov_auth    council_forever    tech_auth_forever
    │                    │                    │
    │    ┌───────────────┼───────────────┐    │
    │    │               │               │    │
    │    ▼               ▼               ▼    │
    └─► Validate multisig witnesses from both bodies
                         │
                         ▼
               staging_gov_threshold
                         │
                         ▼
               Check threshold fractions met
```

## Mitigation Logic Rules

Mitigation fields provide emergency fallback capabilities:

1. **Initial State**: Both `mitigation_logic` and `mitigation_auth` are empty ByteArrays
2. **One-Time Set**: Each can only be set once (empty → non-empty)
3. **Permanent**: Once set, cannot be changed or cleared
4. **Optional Validation**: When set, forever contract requires withdrawal of mitigation logic in addition to main logic

This ensures:
- Emergency capabilities can be added after initial deployment
- Emergency capabilities cannot be removed once added
- Multiple authorization paths for critical operations

## CLI Commands

```bash
# Stage a new logic hash
bun run cli stage-upgrade \
  --network preview \
  --domain reserve \
  --field Logic \
  --hash <new_logic_hash>

# Promote staged logic to main
bun run cli promote-upgrade \
  --network preview \
  --domain reserve \
  --field Logic
```

## Constraint Tags Reference

| Tag | Description |
|-----|-------------|
| TS-* | Two-stage general constraints |
| TSM-* | Two-stage main branch constraints |
| TSS-* | Two-stage staging branch constraints |
| TM-* | Promote (main spending) constraints |
| TSG-* | Stage (staging spending) constraints |
| RUN-* | Withdrawal credential requirements |

See `spec/validators.md` for complete constraint definitions.

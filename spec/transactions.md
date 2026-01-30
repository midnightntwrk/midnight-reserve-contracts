# Transaction Specifications

> **Transaction-organized specification for Midnight Reserve governance contracts.** Each section describes a transaction type, the validators it fires, and the constraints that apply. For exhaustive constraint lists per validator, see [validators.md](validators.md).

---

## Table of Contents

1. [Deploy](#deploy)
   - [Deploy Multisig (Council, Tech Auth)](#deploy-multisig-council-tech-auth)
   - [Deploy Simple (Reserve, ICS)](#deploy-simple-reserve-ics)
   - [Deploy Federated Ops](#deploy-federated-ops)
   - [Deploy Terms and Conditions](#deploy-terms-and-conditions)
   - [Deploy Threshold](#deploy-threshold)
2. [Stage Upgrade](#stage-upgrade)
3. [Promote Upgrade](#promote-upgrade)
4. [Change Council](#change-council)
5. [Change Tech Auth](#change-tech-auth)
6. [Change Federated Ops](#change-federated-ops)
7. [Register Gov Auth](#register-gov-auth)
8. [Dust Create](#dust-create)
9. [Dust Update](#dust-update)
10. [Dust Burn](#dust-burn)

---

## Deploy

Initial governance structure deployment. Multiple deploy transaction variants exist based on the contract family being deployed.

### Deploy Multisig (Council, Tech Auth)

Deploys a multisig-controlled governance body (Council or Technical Authority).

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `*_forever` | Minting | Must consume one-shot UTxO; mint exactly 1 NFT with empty asset name; output to forever address with inline `Multisig` datum |
| `*_two_stage` | Minting | Must consume one-shot UTxO; mint exactly 1 "main" and 1 "staging" NFT; outputs to two-stage address with inline `UpgradeState` datum |

#### Inputs

- One-shot UTxO (consumed to authorize minting)

#### Outputs

1. Two-stage main UTxO at `*_two_stage` address with "main" NFT and `UpgradeState` datum
2. Two-stage staging UTxO at `*_two_stage` address with "staging" NFT and `UpgradeState` datum
3. Forever UTxO at `*_forever` address with empty-name NFT and `VersionedMultisig` datum

#### Minting

- 1 forever NFT (empty asset name)
- 1 "main" NFT under two-stage policy
- 1 "staging" NFT under two-stage policy

#### Redeemer

- Forever: `PermissionedRedeemer` (map of signer payloads)
- Two-stage: Integer `0n`

#### Certificates

- `StakeRegistration` for the logic script (enables withdrawal-based validation)

---

### Deploy Simple (Reserve, ICS)

Deploys a simple governance contract (Reserve or ICS) without multisig validation on the forever datum.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `*_forever` | Minting | Must consume one-shot UTxO; mint exactly 1 NFT with empty asset name; output to forever address with inline datum |
| `*_two_stage` | Minting | Must consume one-shot UTxO; mint exactly 1 "main" and 1 "staging" NFT; outputs to two-stage address with inline `UpgradeState` datum |

#### Inputs

- One-shot UTxO (consumed to authorize minting)

#### Outputs

1. Two-stage main UTxO at `*_two_stage` address with "main" NFT and `UpgradeState` datum
2. Two-stage staging UTxO at `*_two_stage` address with "staging" NFT and `UpgradeState` datum
3. Forever UTxO at `*_forever` address with empty-name NFT and versioned datum

#### Minting

- 1 forever NFT (empty asset name)
- 1 "main" NFT under two-stage policy
- 1 "staging" NFT under two-stage policy

#### Redeemer

- Forever: Integer `0n`
- Two-stage: Integer `0n`

---

### Deploy Federated Ops

Deploys the federated operators registry.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `federated_ops_forever` | Minting | Must consume one-shot UTxO; mint exactly 1 NFT with empty asset name; output to forever address with inline `FederatedOps` datum |
| `federated_ops_two_stage` | Minting | Must consume one-shot UTxO; mint exactly 1 "main" and 1 "staging" NFT; outputs to two-stage address with inline `UpgradeState` datum |

#### Inputs

- Federated ops one-shot UTxO

#### Outputs

1. Two-stage main UTxO with "main" NFT and `UpgradeState` datum
2. Two-stage staging UTxO with "staging" NFT and `UpgradeState` datum
3. Forever UTxO with empty-name NFT and `FederatedOps` datum (includes permissioned candidates list)

#### Minting

- 1 federated ops forever NFT
- 1 "main" NFT
- 1 "staging" NFT

#### Redeemer

- Forever: Integer `0n`
- Two-stage: Integer `0n`

#### Certificates

- `StakeRegistration` for `federated_ops_logic`

---

### Deploy Terms and Conditions

Deploys the terms and conditions contract.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `terms_and_conditions_forever` | Minting | Must consume one-shot UTxO; mint exactly 1 NFT with empty asset name; output with inline `VersionedTermsAndConditions` datum |
| `terms_and_conditions_two_stage` | Minting | Must consume one-shot UTxO; mint exactly 1 "main" and 1 "staging" NFT |

#### Inputs

- Terms and conditions one-shot UTxO

#### Outputs

1. Two-stage main UTxO with "main" NFT and `UpgradeState` datum
2. Two-stage staging UTxO with "staging" NFT and `UpgradeState` datum
3. Forever UTxO with empty-name NFT and `VersionedTermsAndConditions` datum (hash + link)

#### Minting

- 1 terms and conditions forever NFT
- 1 "main" NFT
- 1 "staging" NFT

#### Certificates

- `StakeRegistration` for `terms_and_conditions_logic`

---

### Deploy Threshold

Deploys a governance threshold validator (main_gov, staging_gov, council_update, tech_auth_update, federated_ops_update, terms_and_conditions_update).

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `*_threshold` | Minting | Must consume one-shot UTxO; mint exactly 1 NFT with empty asset name; output with inline `MultisigThreshold` datum |

#### Inputs

- Threshold one-shot UTxO

#### Outputs

1. Threshold UTxO at threshold script address with NFT and `MultisigThreshold` datum

#### Minting

- 1 threshold NFT (empty asset name)

#### Redeemer

- Integer `0n`

#### Datum Structure

`MultisigThreshold` is a tuple: `[tech_auth_num, tech_auth_denom, council_num, council_denom]`

---

## Stage Upgrade

Updates the staging NFT datum with a new script hash for one of four fields (Logic, Auth, MitigationLogic, MitigationAuth).

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `*_two_stage` | Spending | Must spend staging NFT; redeemer specifies field + `Staging` variant with main UTxO reference and new hash; output preserves staging NFT with updated field |
| `staging_gov_auth` | Withdrawal | Validates authorization via tech auth + council multisig witness tokens |
| `staging_gov_threshold` | Reference | Provides threshold fractions for signature requirements |
| `tech_auth_forever` | Reference | Provides current tech auth signers |
| `council_forever` | Reference | Provides current council signers |
| `council_two_stage` | Reference | For `staging_gov_auth`'s logic_is_on_main check |

#### Inputs

- Staging UTxO (spent with `TwoStageRedeemer`)
- User UTxO (for fees)

#### Reference Inputs

- Main UTxO (to read current state)
- Staging gov threshold UTxO
- Tech auth forever UTxO
- Council forever UTxO
- Council two-stage main UTxO

#### Outputs

1. Updated staging UTxO at two-stage address with staging NFT and updated `UpgradeState` datum (incremented `logic_round`)

#### Minting

- Tech auth witness token with asset name `"tech-auth-witness"` (native multisig script)
- Council witness token with asset name `"council-auth-witness"` (native multisig script)

#### Withdrawals

- `staging_gov_auth` at 0 ADA with `PermissionedRedeemer`

#### Redeemer

`TwoStageRedeemer` tuple: `[UpdateField, WhichStage]`
- `UpdateField`: `"Logic"` | `"Auth"` | `"MitigationLogic"` | `"MitigationAuth"`
- `WhichStage`: `{ Staging: [OutRef, new_script_hash] }`

---

## Promote Upgrade

Promotes the staged upgrade to main by consuming the main NFT and copying the staged logic hash.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `*_two_stage` | Spending | Must spend main NFT; redeemer specifies field + `Main` variant with staging UTxO reference; output preserves main NFT with logic from staging |
| `main_gov_auth` | Withdrawal | Validates authorization via tech auth + council multisig witness tokens |
| `main_gov_threshold` | Reference | Provides threshold fractions for signature requirements |
| `tech_auth_forever` | Reference | Provides current tech auth signers |
| `council_forever` | Reference | Provides current council signers |

#### Inputs

- Main UTxO (spent with `TwoStageRedeemer`)
- User UTxO (for fees)

#### Reference Inputs

- Staging UTxO (to read staged logic hash)
- Main gov threshold UTxO
- Tech auth forever UTxO
- Council forever UTxO

#### Outputs

1. Updated main UTxO at two-stage address with main NFT and updated `UpgradeState` datum (new logic hash, incremented `round`)

#### Minting

- Tech auth witness token with asset name `"tech-auth-witness"` (native multisig script)
- Council witness token with asset name `"council-auth-witness"` (native multisig script)

#### Withdrawals

- `main_gov_auth` at 0 ADA with `PermissionedRedeemer`

#### Redeemer

`TwoStageRedeemer` tuple: `[UpdateField, WhichStage]`
- `UpdateField`: `"Logic"`
- `WhichStage`: `{ Main: [OutRef] }` (references staging UTxO)

---

## Change Council

Updates the council membership by spending the council forever UTxO.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `council_forever` | Spending | Must spend forever NFT; output preserves NFT with updated `VersionedMultisig` datum |
| `council_logic` | Withdrawal | Validates multisig authorization via ML-0..ML-5 constraints |
| `main_council_update_threshold` | Reference | Provides threshold fractions |
| `tech_auth_forever` | Reference | For ML-3 validation (tech auth witness) |
| `council_two_stage` | Reference | To read logic hash from `UpgradeState` |

#### Inputs

- Council forever UTxO (spent)
- User UTxO (for fees)

#### Reference Inputs

- Council update threshold UTxO
- Tech auth forever UTxO
- Council two-stage main UTxO

#### Outputs

1. Updated council forever UTxO with same NFT and new `VersionedMultisig` datum

#### Minting

- Council witness token (native multisig script from current council signers)
- Tech auth witness token (native multisig script from tech auth signers)

#### Withdrawals

- `council_logic` at 0 ADA with `PermissionedRedeemer` (new member map)

#### Redeemer

- Council forever: Integer `0n`

---

## Change Tech Auth

Updates the technical authority membership by spending the tech auth forever UTxO.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `tech_auth_forever` | Spending | Must spend forever NFT; output preserves NFT with updated `VersionedMultisig` datum |
| `tech_auth_logic` | Withdrawal | Validates multisig authorization via ML-0..ML-5 constraints |
| `main_tech_auth_update_threshold` | Reference | Provides threshold fractions |
| `council_forever` | Reference | For ML-4 validation (council witness) |
| `tech_auth_two_stage` | Reference | To read logic hash from `UpgradeState` |

#### Inputs

- Tech auth forever UTxO (spent)
- User UTxO (for fees)

#### Reference Inputs

- Tech auth update threshold UTxO
- Council forever UTxO
- Tech auth two-stage main UTxO

#### Outputs

1. Updated tech auth forever UTxO with same NFT and new `VersionedMultisig` datum

#### Minting

- Tech auth witness token (native multisig script from current tech auth signers)
- Council witness token (native multisig script from council signers)

#### Withdrawals

- `tech_auth_logic` at 0 ADA with `PermissionedRedeemer` (new member map)

#### Redeemer

- Tech auth forever: Integer `0n`

---

## Change Federated Ops

Updates the federated operators list by spending the federated ops forever UTxO.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `federated_ops_forever` | Spending | Must spend forever NFT; output preserves NFT with updated `FederatedOps` datum (preserves `logic_round`) |
| `federated_ops_logic` | Withdrawal | Validates multisig authorization |
| `main_federated_ops_update_threshold` | Reference | Provides threshold fractions |
| `council_forever` | Reference | For council witness validation |
| `tech_auth_forever` | Reference | For tech auth witness validation |
| `federated_ops_two_stage` | Reference | To read logic hash from `UpgradeState` |

#### Inputs

- Federated ops forever UTxO (spent)
- User UTxO (for fees)

#### Reference Inputs

- Federated ops update threshold UTxO
- Council forever UTxO
- Tech auth forever UTxO
- Federated ops two-stage main UTxO

#### Outputs

1. Updated federated ops forever UTxO with same NFT and new `FederatedOps` datum

#### Minting

- Council witness token (native multisig script)
- Tech auth witness token (native multisig script)

#### Withdrawals

- `federated_ops_logic` at 0 ADA with Integer `0n` redeemer

---

## Register Gov Auth

Registers the governance auth scripts as stake credentials (one-time setup after deploy).

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `main_gov_auth` | Registration | Registers stake credential |
| `staging_gov_auth` | Registration | Registers stake credential |

#### Inputs

- User UTxO (for fees and deposit)

#### Outputs

- Change output

#### Certificates

- `StakeRegistration` for `main_gov_auth` script hash
- `StakeRegistration` for `staging_gov_auth` script hash

---

## Dust Create

Creates a new dust mapping by minting a dust NFT and storing the mapping datum.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `cnight_generates_dust` | Minting | Must consume input UTxO (input_linked_mint); datum must be valid `DustMappingDatum`; dust_address ≤ 33 bytes; c_wallet owner must sign or withdraw |

#### Inputs

- User UTxO (consumed for one-shot minting authorization)

#### Outputs

1. Dust UTxO at `cnight_generates_dust` address with dust NFT and inline `DustMappingDatum`

#### Minting

- 1 dust NFT (empty asset name under `cnight_generates_dust` policy)

#### Redeemer

- `DustAction`: `"Create"`

#### Required Signatures

- If `c_wallet` is `VerificationKey`: key must be in `extra_signatories`
- If `c_wallet` is `Script`: credential must appear in withdrawals

#### Datum Structure

```
DustMappingDatum {
  c_wallet: Credential (VerificationKey or Script),
  dust_address: ByteArray (≤ 33 bytes)
}
```

---

## Dust Update

Updates dust mappings using the withdrawal mechanism (batch update of multiple UTxOs).

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `cnight_generates_dust` | Spending | Each spent input must have inline `DustMappingDatum`; must include withdrawal |
| `cnight_generates_dust` | Withdrawal | Each replacement output must carry exactly one dust NFT; must retain same NFT identity; must have inline datum |

#### Inputs

- Dust UTxOs to update (spent)

#### Outputs

- Updated dust UTxOs at same address with same NFTs and new `DustMappingDatum` values

#### Withdrawals

- `cnight_generates_dust` at 0 ADA with `DustAction` redeemer

#### Redeemer

- Spending: `DustAction`: `"Create"`
- Withdrawal: `DustAction`: `"Create"`

#### Required Signatures

- Owner of each `c_wallet` being updated

---

## Dust Burn

Burns dust NFTs by spending dust UTxOs and minting negative quantities.

#### Validators Fired

| Validator | Context | Constraints |
|-----------|---------|-------------|
| `cnight_generates_dust` | Spending | Each spent input must have inline `DustMappingDatum` |
| `cnight_generates_dust` | Minting | Mint map must record negated count of consumed dust NFTs |

#### Inputs

- Dust UTxOs to burn (spent)

#### Outputs

- No dust outputs (tokens are burned)

#### Minting

- Negative quantity of dust NFTs equal to number burned (e.g., `-2n` for 2 UTxOs)

#### Redeemer

- Spending: `DustAction`: `"Burn"`
- Minting: `DustAction`: `"Burn"`

#### Required Signatures

- Owner of each `c_wallet` being burned

---

## Appendix: Datum Types

### UpgradeState

```
UpgradeState = [
  logic_hash: ByteArray,        // 28 bytes
  mitigation_logic: ByteArray,  // 28 bytes or empty
  gov_auth: ByteArray,          // 28 bytes
  mitigation_auth: ByteArray,   // 28 bytes or empty
  round: Int,                   // version round counter
  logic_round: Int              // incremented on stage/promote
]
```

### VersionedMultisig

```
VersionedMultisig = [
  [total_signers: Int, signers: Map<PaymentHash, SR25519Key>],
  round: Int
]
```

### FederatedOps

```
FederatedOps = [
  Unit,
  List<PermissionedCandidateDatumV1>,
  logic_round: Int
]
```

### MultisigThreshold

```
MultisigThreshold = [
  tech_auth_numerator: Int,
  tech_auth_denominator: Int,
  council_numerator: Int,
  council_denominator: Int
]
```

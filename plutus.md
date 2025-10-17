# generated Type Documentation

## crate root

### struct `ValidatorScript`

```rust
pub struct ValidatorScript<P> {
    pub title: &'static str,
    pub compiled_code: &'static str,
    pub hash: &'static str,
    pub parameters: P,
}
```

### enum `Void`

```rust
pub enum Void {
    Value,
}
```

### type `Data`

```rust
pub type Data = PlutusData;
```

### type `Int`

```rust
pub type Int = num_bigint::BigInt;
```

## module `aiken::crypto`

### type `ScriptHash`

```rust
        pub type ScriptHash = ByteArray;
```

### type `VerificationKeyHash`

```rust
        pub type VerificationKeyHash = ByteArray;
```

## module `bridge::types`

### struct `AuthoritySetCommitment`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct AuthoritySetCommitment {
            pub id: Int,
            pub len: Int,
            pub root: ByteArray,
        }
```

### struct `BeefyConsensusState`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct BeefyConsensusState {
            pub latest_height: Int,
            pub activation_block: Int,
            pub current_authority_set: AuthoritySetCommitment,
            pub next_authority_set: AuthoritySetCommitment,
        }
```

### struct `BeefyMmrLeaf`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct BeefyMmrLeaf {
            pub version: Int,
            pub parent_number: Int,
            pub parent_hash: ByteArray,
            pub next_authority_set: AuthoritySetCommitment,
            pub extra: ByteArray,
            pub k_index: Int,
            pub leaf_index: Int,
        }
```

### struct `Commitment`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct Commitment {
            pub payloads: Vec<Payload>,
            pub block_number: Int,
            pub validator_set_id: Int,
        }
```

### struct `Payload`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct Payload {
            pub id: ByteArray,
            pub data: ByteArray,
        }
```

### struct `RelayChainProof`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct RelayChainProof {
            pub signed_commitment: SignedCommitment,
            pub latest_mmr_leaf: BeefyMmrLeaf,
            pub mmr_proof: Data,
            pub proof: Data,
        }
```

### struct `SignedCommitment`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct SignedCommitment {
            pub commitment: Commitment,
            pub votes: Vec<Vote>,
        }
```

### struct `Vote`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct Vote {
            pub signature: ByteArray,
            pub authority_index: Int,
            pub public_key: ByteArray,
        }
```

## module `cardano::address`

### enum `Credential`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub enum Credential {
            VerificationKey { verification_key_hash: super::super::aiken::crypto::VerificationKeyHash },
            Script { script_hash: super::super::aiken::crypto::ScriptHash },
        }
```

## module `cardano::transaction`

### struct `OutputReference`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct OutputReference {
            pub transaction_id: ByteArray,
            pub index: Int,
        }
```

## module `cnight_generates_dust`

### enum `DustAction`

```rust
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub enum DustAction {
        Create,
        Burn,
    }
```

### struct `DustMappingDatum`

```rust
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct DustMappingDatum {
        pub c_wallet: super::cardano::address::Credential,
        pub address: ByteArray,
    }
```

### type `ElseRedeemer`

```rust
    pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
    pub struct ElseValidator;
```

## module `committee_bridge::committee_bridge_forever`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `committee_bridge::committee_bridge_logic`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `committee_bridge::committee_bridge_two_stage_upgrade`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `committee_bridge::simple_bridge`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `gov_auth::main_gov_auth`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `gov_auth::staging_gov_auth`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `iliquid_circulation_supply::ics_forever`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `iliquid_circulation_supply::ics_logic`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `iliquid_circulation_supply::ics_two_stage_upgrade`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `multisig::types`

### type `Multisig`

```rust
        pub type Multisig = (Int, Data);
```

### struct `MultisigThreshold`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct MultisigThreshold {
            pub technical_auth_numerator: Int,
            pub technical_auth_denominator: Int,
            pub council_numerator: Int,
            pub council_denominator: Int,
        }
```

## module `permissioned::council_forever`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `permissioned::council_logic`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `permissioned::council_two_stage_upgrade`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `permissioned::federated_ops_forever`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `permissioned::federated_ops_logic`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `permissioned::federated_ops_two_stage_upgrade`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `permissioned::tech_auth_forever`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `permissioned::tech_auth_logic`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `permissioned::tech_auth_two_stage_upgrade`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `reserve::reserve_forever`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `reserve::reserve_logic`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `reserve::reserve_two_stage_upgrade`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `thresholds::main_council_update_threshold`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `thresholds::main_federated_ops_update_threshold`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `thresholds::main_gov_threshold`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `thresholds::main_tech_auth_update_threshold`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `thresholds::staging_gov_threshold`

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `upgradable::types`

### struct `TwoStageRedeemer`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct TwoStageRedeemer {
            pub update_field: UpdateField,
            pub which_stage: WhichStage,
        }
```

### enum `UpdateField`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub enum UpdateField {
            Logic,
            Auth,
            MitigationLogic,
            MitigationAuth,
        }
```

### type `UpgradeState`

```rust
        pub type UpgradeState = (super::super::aiken::crypto::ScriptHash, super::super::aiken::crypto::ScriptHash, super::super::aiken::crypto::ScriptHash, super::super::aiken::crypto::ScriptHash, Int);
```

### enum `WhichStage`

```rust
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub enum WhichStage {
            Main { output_reference: super::super::cardano::transaction::OutputReference },
            Staging { output_reference: super::super::cardano::transaction::OutputReference, script_hash: super::super::aiken::crypto::ScriptHash },
        }
```

## module `validator_types::z_committee_bridge_types`

### type `SpendDatum`

```rust
        pub type SpendDatum = super::super::bridge::types::BeefyConsensusState;
```

### type `SpendRedeemer`

```rust
        pub type SpendRedeemer = super::super::bridge::types::RelayChainProof;
```

### struct `SpendValidator;`

```rust
        pub struct SpendValidator;
```

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `validator_types::z_generates_dust`

### type `SpendDatum`

```rust
        pub type SpendDatum = super::super::cnight_generates_dust::DustMappingDatum;
```

### type `SpendRedeemer`

```rust
        pub type SpendRedeemer = super::super::cnight_generates_dust::DustAction;
```

### struct `SpendValidator;`

```rust
        pub struct SpendValidator;
```

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `validator_types::z_permissioned_types`

### type `SpendDatum`

```rust
        pub type SpendDatum = super::super::multisig::types::Multisig;
```

### type `SpendRedeemer`

```rust
        pub type SpendRedeemer = Vec<super::super::aiken::crypto::VerificationKeyHash>;
```

### struct `SpendValidator;`

```rust
        pub struct SpendValidator;
```

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `validator_types::z_threshold_types`

### type `SpendDatum`

```rust
        pub type SpendDatum = super::super::multisig::types::MultisigThreshold;
```

### type `SpendRedeemer`

```rust
        pub type SpendRedeemer = Data;
```

### struct `SpendValidator;`

```rust
        pub struct SpendValidator;
```

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```

## module `validator_types::z_two_stage_upgrade_types`

### type `SpendDatum`

```rust
        pub type SpendDatum = super::super::upgradable::types::UpgradeState;
```

### type `SpendRedeemer`

```rust
        pub type SpendRedeemer = super::super::upgradable::types::TwoStageRedeemer;
```

### struct `SpendValidator;`

```rust
        pub struct SpendValidator;
```

### type `ElseRedeemer`

```rust
        pub type ElseRedeemer = ();
```

### struct `ElseValidator;`

```rust
        pub struct ElseValidator;
```


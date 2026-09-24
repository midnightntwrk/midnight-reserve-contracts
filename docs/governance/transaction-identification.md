# Midnight Reserve: Transaction Identification Guide

## Primary Identifier: CIP-20 Transaction Metadata

Every governance transaction includes a CIP-20 metadata message (label 674) that unambiguously identifies the transaction type. This is the simplest and most reliable way to identify transactions.

### On-chain format

```json
{
  "674": {
    "msg": ["midnight-reserve:<transaction-type>"]
  }
}
```

### Transaction Types

| Transaction Type     | Metadata Message                        |
| -------------------- | --------------------------------------- |
| Change Council       | `midnight-reserve:change-council`       |
| Change Tech Auth     | `midnight-reserve:change-tech-auth`     |
| Change Federated Ops | `midnight-reserve:change-federated-ops` |
| Change Terms         | `midnight-reserve:change-terms`         |
| Stage Upgrade        | `midnight-reserve:stage-upgrade`        |
| Promote Upgrade      | `midnight-reserve:promote-upgrade`      |

Block explorers (CardanoScan, CExplorer) display CIP-20 messages directly on the transaction detail page under "Metadata".

---

## Transaction Example: Change Terms and Conditions

```
change-terms-tx.json
Imported from raw transaction.
Transaction ID: 8f3a1b...c7d2e4
Minted assets:
  <council_native_script_hash> "" => 1
  <tech_auth_native_script_hash> "" => 1
Inputs:
  b451d1433c...3fbd48#5  (user UTxO for fees)
  ee...ee#0              (terms_and_conditions_forever, redeemer: 0)
Reference inputs:
  c0...c0#0              (terms_and_conditions_threshold)
  55...55#0              (council_forever)
  dd...dd#0              (tech_auth_forever)
  c1...c1#0              (terms_and_conditions_two_stage, "main" NFT)
Outputs:
  addr_test1wz...terms_forever => 2000000
    assets:
      <terms_forever_script_hash> "" => 1
    datum (VersionedTermsAndConditions):
      terms_and_conditions:
        hash: a1b2c3d4e5f6...64 hex chars...90abcdef12345678
        link: 68747470733a2f2f6578616d706c652e636f6d2f7465726d73
              (hex-encoded "https://example.com/terms")
      logic_round: 0
  addr_test1qz...deployer => 97814523
    (change output)
Withdrawals:
  stake_test17...terms_logic => 0
Metadata:
  674: {"msg": ["midnight-reserve:change-terms"]}
```

### Datum Structure

```
VersionedTermsAndConditions = [
  terms_and_conditions: [
    hash: ByteArray,    // 32-byte hash (64 hex chars)
    link: ByteArray     // hex-encoded URL string
  ],
  logic_round: Int
]
```

# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-19T04:54:58.478Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash 376a4025f3d80d70753994c9e556d4c6365b9f86521966e67487a402
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 10a2c29d69c235cd183232bdf964c84c9bcfbfbcb18e248b970efff4
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 173f6d106cc154928ac1191e42e1421e6ea3b1e4914547aa43881f10
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 4c411b663529050a4832f622aea3bcde02334976876dd658fe1b80a3
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash 1b51a5502672b5cd2f2960a0660b21f5973c61a86a692db7cbef2e54
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 7c60a98d7a151012826bfdd7c6682fc312e0b02e3ea0f9028f939a2b
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: fd54acf38f99901c3afbe5ce05ef29aee41ed53a5eb10f560afa9d23332a909d
Expected policy IDs (from NFTs): [376a4025f3d80d70753994c9e556d4c6365b9f86521966e67487a402, b1599af2750a3839c4e0d85f097239e6938a80cc05b7f734fdf62a2f]
Actual on-chain policy IDs:      [376a4025f3d80d70753994c9e556d4c6365b9f86521966e67487a402, b1599af2750a3839c4e0d85f097239e6938a80cc05b7f734fdf62a2f]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=0e5e243678b79430339df114426a4bd0dd5753a3080f57a90d5eb01d]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 02e45328221db1455fa354a7aa4edc5483490e04b38c09efd7d37ff9295ab188
Expected policy IDs (from NFTs): [06d88cba7561eb78fd0ba4c01f9db8b4c4bd6cdb2a640e4bc30c93f4]
Actual on-chain policy IDs:      [06d88cba7561eb78fd0ba4c01f9db8b4c4bd6cdb2a640e4bc30c93f4]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: e4dbed5ea3e9da997d71dfaf9cb25168ca3a3de41e54ac55a5a478caaab38f48
Expected policy IDs (from NFTs): [10a2c29d69c235cd183232bdf964c84c9bcfbfbcb18e248b970efff4, 19589b725450130c17f29438985eeeed9f74f0accf323d36db3ee515]
Actual on-chain policy IDs:      [10a2c29d69c235cd183232bdf964c84c9bcfbfbcb18e248b970efff4, 19589b725450130c17f29438985eeeed9f74f0accf323d36db3ee515]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=4190700e5bc227ca7ece7b5b59365cb9fc8680fdbe99ea3726e9fdeb]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: 1f3134024fcc9cd095b49b71129f9c4af470e0b934c47622081a3dd25571f4b8
Expected policy IDs (from NFTs): [ce2ac1f73064b2f6575d4c4b7c8eb7856905013320250938e0199c64]
Actual on-chain policy IDs:      [ce2ac1f73064b2f6575d4c4b7c8eb7856905013320250938e0199c64]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 2a45c572ca47df7789fe29f8b47fb98579615c8669c973b98e9903eb15695a8e
Expected policy IDs (from NFTs): [173f6d106cc154928ac1191e42e1421e6ea3b1e4914547aa43881f10, 1c0bff04bccf609f4e387042069ed7bff5ebb1b25be2f0f3bd012e48]
Actual on-chain policy IDs:      [173f6d106cc154928ac1191e42e1421e6ea3b1e4914547aa43881f10, 1c0bff04bccf609f4e387042069ed7bff5ebb1b25be2f0f3bd012e48]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=e9cc843ef8b95bd2a21b57ccaa26f7b85a4fe539bd6bddd6f857dde2]
```

### [PASS] On-chain: ics-deployment

```
Tx: ae1739b91634855402841b55ddbad47e21c9130ec0c59cee1be7f8065a12f9ad
Expected policy IDs (from NFTs): [4c411b663529050a4832f622aea3bcde02334976876dd658fe1b80a3, 52d217eb93d769e728b859ac91753a8a0f6f387db3d2483d3bcceda9]
Actual on-chain policy IDs:      [4c411b663529050a4832f622aea3bcde02334976876dd658fe1b80a3, 52d217eb93d769e728b859ac91753a8a0f6f387db3d2483d3bcceda9]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=69e0994ae071683094a3ab3c19a51b116839c8b7c9390d2d71112175]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 19b8048028910baa586eebe7e6cd9311b5bbb0afea7dc8e551528e731c544ab3
Expected policy IDs (from NFTs): [9ceb655a2fe8022cb8ec16ea9ec3fdf5995b7f89d6b2e6545bbffba1]
Actual on-chain policy IDs:      [9ceb655a2fe8022cb8ec16ea9ec3fdf5995b7f89d6b2e6545bbffba1]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: c6bfb9df3f6d5a5f6aeb6929919c65b6b7682891a6675e3202e9935d13ce65c8
Expected policy IDs (from NFTs): [32fb24b7df04eef15edb512e058e4c885bcdf0165dc686c270e9e896]
Actual on-chain policy IDs:      [32fb24b7df04eef15edb512e058e4c885bcdf0165dc686c270e9e896]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 5dd8b0445840d5e4076dc22893890f2c457077168c51cab6db89f229cecbf04b
Expected policy IDs (from NFTs): [1b51a5502672b5cd2f2960a0660b21f5973c61a86a692db7cbef2e54, bc95da29d82d6450a6e5ab3e1672dc8acfa3ba20290ca4eb8ef96579]
Actual on-chain policy IDs:      [1b51a5502672b5cd2f2960a0660b21f5973c61a86a692db7cbef2e54, bc95da29d82d6450a6e5ab3e1672dc8acfa3ba20290ca4eb8ef96579]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=2a5031ea27c383bb53098b56e96de3cff62acc45f8b9ff6719b839d8]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: d18586f4fa5ede3e2b34a6857ce1968e041d3466f29c77900146767efc8a0429
Expected policy IDs (from NFTs): [439cbcb9808746c08db5a3cc625e4269a05cad719721a42038dcc90b]
Actual on-chain policy IDs:      [439cbcb9808746c08db5a3cc625e4269a05cad719721a42038dcc90b]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 9ebad7af446de92f0a4ad65bb4c02acb1dd9c63a11cf345d7721897bbab9e3e3
Expected policy IDs (from NFTs): [330e938f9f4bf10e0b83639616f9344dbf19c08dbca3e3da1cc808e6, 7c60a98d7a151012826bfdd7c6682fc312e0b02e3ea0f9028f939a2b]
Actual on-chain policy IDs:      [330e938f9f4bf10e0b83639616f9344dbf19c08dbca3e3da1cc808e6, 7c60a98d7a151012826bfdd7c6682fc312e0b02e3ea0f9028f939a2b]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=ba0bbd6533b7ced733184a1a7cb0dc9dd16f8eecc48dff5da55a5cdf]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: b5aa2af38c87e52c1d998016461f6d990521a3a1167b8b50f67b9f8116579200
Expected policy IDs (from NFTs): [5a3523d219a001a866b11b242ec8e805cab26b92bc0f7fdcb698d7f8]
Actual on-chain policy IDs:      [5a3523d219a001a866b11b242ec8e805cab26b92bc0f7fdcb698d7f8]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: fd54acf38f99901c3afbe5ce05ef29aee41ed53a5eb10f560afa9d23332a909d
Logic hash - expected: 0e5e243678b79430339df114426a4bd0dd5753a3080f57a90d5eb01d, actual: 0e5e243678b79430339df114426a4bd0dd5753a3080f57a90d5eb01d PASS
Auth hash (main_gov_auth) - expected: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e, actual: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: e4dbed5ea3e9da997d71dfaf9cb25168ca3a3de41e54ac55a5a478caaab38f48
Logic hash - expected: 4190700e5bc227ca7ece7b5b59365cb9fc8680fdbe99ea3726e9fdeb, actual: 4190700e5bc227ca7ece7b5b59365cb9fc8680fdbe99ea3726e9fdeb PASS
Auth hash (main_gov_auth) - expected: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e, actual: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 2a45c572ca47df7789fe29f8b47fb98579615c8669c973b98e9903eb15695a8e
Logic hash - expected: e9cc843ef8b95bd2a21b57ccaa26f7b85a4fe539bd6bddd6f857dde2, actual: e9cc843ef8b95bd2a21b57ccaa26f7b85a4fe539bd6bddd6f857dde2 PASS
Auth hash (main_gov_auth) - expected: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e, actual: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: ae1739b91634855402841b55ddbad47e21c9130ec0c59cee1be7f8065a12f9ad
Logic hash - expected: 69e0994ae071683094a3ab3c19a51b116839c8b7c9390d2d71112175, actual: 69e0994ae071683094a3ab3c19a51b116839c8b7c9390d2d71112175 PASS
Auth hash (main_gov_auth) - expected: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e, actual: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 5dd8b0445840d5e4076dc22893890f2c457077168c51cab6db89f229cecbf04b
Logic hash - expected: 2a5031ea27c383bb53098b56e96de3cff62acc45f8b9ff6719b839d8, actual: 2a5031ea27c383bb53098b56e96de3cff62acc45f8b9ff6719b839d8 PASS
Auth hash (main_gov_auth) - expected: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e, actual: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 9ebad7af446de92f0a4ad65bb4c02acb1dd9c63a11cf345d7721897bbab9e3e3
Logic hash - expected: ba0bbd6533b7ced733184a1a7cb0dc9dd16f8eecc48dff5da55a5cdf, actual: ba0bbd6533b7ced733184a1a7cb0dc9dd16f8eecc48dff5da55a5cdf PASS
Auth hash (main_gov_auth) - expected: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e, actual: a06ca61685933b73215f27882c851fb1354f562187002640bedef09e PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: fd54acf38f99901c3afbe5ce05ef29aee41ed53a5eb10f560afa9d23332a909d
Logic hash - expected: 0e5e243678b79430339df114426a4bd0dd5753a3080f57a90d5eb01d, actual: 0e5e243678b79430339df114426a4bd0dd5753a3080f57a90d5eb01d PASS
Auth hash (staging_gov_auth) - expected: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380, actual: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380 PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: e4dbed5ea3e9da997d71dfaf9cb25168ca3a3de41e54ac55a5a478caaab38f48
Logic hash - expected: 4190700e5bc227ca7ece7b5b59365cb9fc8680fdbe99ea3726e9fdeb, actual: 4190700e5bc227ca7ece7b5b59365cb9fc8680fdbe99ea3726e9fdeb PASS
Auth hash (staging_gov_auth) - expected: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380, actual: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380 PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 2a45c572ca47df7789fe29f8b47fb98579615c8669c973b98e9903eb15695a8e
Logic hash - expected: e9cc843ef8b95bd2a21b57ccaa26f7b85a4fe539bd6bddd6f857dde2, actual: e9cc843ef8b95bd2a21b57ccaa26f7b85a4fe539bd6bddd6f857dde2 PASS
Auth hash (staging_gov_auth) - expected: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380, actual: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380 PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: ae1739b91634855402841b55ddbad47e21c9130ec0c59cee1be7f8065a12f9ad
Logic hash - expected: 69e0994ae071683094a3ab3c19a51b116839c8b7c9390d2d71112175, actual: 69e0994ae071683094a3ab3c19a51b116839c8b7c9390d2d71112175 PASS
Auth hash (staging_gov_auth) - expected: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380, actual: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380 PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 5dd8b0445840d5e4076dc22893890f2c457077168c51cab6db89f229cecbf04b
Logic hash - expected: 2a5031ea27c383bb53098b56e96de3cff62acc45f8b9ff6719b839d8, actual: 2a5031ea27c383bb53098b56e96de3cff62acc45f8b9ff6719b839d8 PASS
Auth hash (staging_gov_auth) - expected: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380, actual: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380 PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 9ebad7af446de92f0a4ad65bb4c02acb1dd9c63a11cf345d7721897bbab9e3e3
Logic hash - expected: ba0bbd6533b7ced733184a1a7cb0dc9dd16f8eecc48dff5da55a5cdf, actual: ba0bbd6533b7ced733184a1a7cb0dc9dd16f8eecc48dff5da55a5cdf PASS
Auth hash (staging_gov_auth) - expected: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380, actual: 419a467285559841c87a091286dc5525d1b2e9ed11eced90ea3b3380 PASS
```

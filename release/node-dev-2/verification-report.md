# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-18T21:27:36.175Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash cb85e7f295187f328f3add60c6ffc72f819f6d72e3af16e5130f0b3a
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash de5044557edefd2e571ab21df51ae66530d333c9ad041f26d13d38d7
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 4e6beb6bd272218c091f975b9ac31f784ff56df389cd479c0e296992
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash a4553f2a8ced53149449f8421e6b2ed581424c2bb5ad1792c2384647
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash de444f3300b4c0f2d851fd1ff64672af7e47a170cf108c6a464614b8
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash e7974d60e96f60aff687f5b732e09b5cecc874647603f40306d82a56
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: 95e3dbd57e64b9d030ed032a2b8ee0875b8c298e119576b2142c56992d2fb042
Expected policy IDs (from NFTs): [511ef6e8a762c68a3736474e344876a049188ccba2397146e8505c90, cb85e7f295187f328f3add60c6ffc72f819f6d72e3af16e5130f0b3a]
Actual on-chain policy IDs:      [511ef6e8a762c68a3736474e344876a049188ccba2397146e8505c90, cb85e7f295187f328f3add60c6ffc72f819f6d72e3af16e5130f0b3a]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=3312422df33f38c9c7827347c8ca383acddd53ac0da1175e7e8aa0b8]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 63f9475eb609ecf66abc96e7d5faa5eb2c380d2f8923e049b4bd9af92c97ad64
Expected policy IDs (from NFTs): [0de86c04c5649e5cc907c587dc913b71948678e329856d191e483b2e]
Actual on-chain policy IDs:      [0de86c04c5649e5cc907c587dc913b71948678e329856d191e483b2e]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: 4f785e13d0bb748721e6a4b7fdfae0c3cf6e1017cf5d474f4893345bfd2bb811
Expected policy IDs (from NFTs): [85ad4a746301c0496e5a085ea0c5e78203c3fabdb032fa49bd389de2, de5044557edefd2e571ab21df51ae66530d333c9ad041f26d13d38d7]
Actual on-chain policy IDs:      [85ad4a746301c0496e5a085ea0c5e78203c3fabdb032fa49bd389de2, de5044557edefd2e571ab21df51ae66530d333c9ad041f26d13d38d7]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=8c665fb2f97d1bca068e51e9c7534ecc56351271edc9c0106972e0a8]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: 78d9b967e204cff4199f355b02c0413749baa01b1f8e1b66d1c903ea58eaee6f
Expected policy IDs (from NFTs): [cdef493e96505897c31d4945b9cb0ce18ae696cb4682c7e733b26bba]
Actual on-chain policy IDs:      [cdef493e96505897c31d4945b9cb0ce18ae696cb4682c7e733b26bba]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 1dceb621dfc74cde3ba5520a5eea910d959a8fe855b1e89a43ca2a5f13ec0c6f
Expected policy IDs (from NFTs): [4e6beb6bd272218c091f975b9ac31f784ff56df389cd479c0e296992, bc77a88b8f7cb96c8a0f53458cb259c0b5d2ab0157a3b8c6fe0b7d14]
Actual on-chain policy IDs:      [4e6beb6bd272218c091f975b9ac31f784ff56df389cd479c0e296992, bc77a88b8f7cb96c8a0f53458cb259c0b5d2ab0157a3b8c6fe0b7d14]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=939b00ad9a65f081f9d7737321f48caef86803fd2bf893665c46bedb]
```

### [PASS] On-chain: ics-deployment

```
Tx: b4a2acefc16e878d396b2dd999c2166f0d4a63aafd2fe54cef5752b7f9526956
Expected policy IDs (from NFTs): [0e7283e905c07880c9b3548812bbcbd97981897f23dd88fab90be5f9, a4553f2a8ced53149449f8421e6b2ed581424c2bb5ad1792c2384647]
Actual on-chain policy IDs:      [0e7283e905c07880c9b3548812bbcbd97981897f23dd88fab90be5f9, a4553f2a8ced53149449f8421e6b2ed581424c2bb5ad1792c2384647]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=b86132f05d7304fc3a2d3b135756fddab38d45e549f57a691c2c80e8]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: c19162e3a3872225d41601c8d4c9dccf1c1a56d77addefa4e70a4e52311bfd65
Expected policy IDs (from NFTs): [7979fc710549dd67963ab2da413220a3bb7916917804c38ab0e69645]
Actual on-chain policy IDs:      [7979fc710549dd67963ab2da413220a3bb7916917804c38ab0e69645]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 2199523cca89f20ca8ac8f2bfafb305c5d39f7bb24fe6d73b026db15cc21dea3
Expected policy IDs (from NFTs): [b770b08e6bb5814bba6b9e56bf957eb03acc43114a3c5582271b98b7]
Actual on-chain policy IDs:      [b770b08e6bb5814bba6b9e56bf957eb03acc43114a3c5582271b98b7]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: a455337d1e105364e09f19dcbd37a95b0b8dd6f9517aa69630bad9eee3f8d733
Expected policy IDs (from NFTs): [4a081eb41b2c00508184bf25116e12684e1270d1580195ca97bebbdf, de444f3300b4c0f2d851fd1ff64672af7e47a170cf108c6a464614b8]
Actual on-chain policy IDs:      [4a081eb41b2c00508184bf25116e12684e1270d1580195ca97bebbdf, de444f3300b4c0f2d851fd1ff64672af7e47a170cf108c6a464614b8]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=c76963dd635b1b88f438e3b4687ea3d80ee5ed9c4299eeddc2be9a62]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 70137ce6868b75573cdb1b0121c346a8fd0f77bf52fc93b54f2500a67e6444a8
Expected policy IDs (from NFTs): [8bc10592766c4b457db793d05c6358203255711ecb5d7ed8c36ea0ec]
Actual on-chain policy IDs:      [8bc10592766c4b457db793d05c6358203255711ecb5d7ed8c36ea0ec]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: d81714c8e0a530f894ad683eaecc50fde2106d1b618f6a0bc87c8b54178740ef
Expected policy IDs (from NFTs): [e7974d60e96f60aff687f5b732e09b5cecc874647603f40306d82a56, ef887e86b1973cbac2c3580e6ba584f488adeb1144550aec6054b8bd]
Actual on-chain policy IDs:      [e7974d60e96f60aff687f5b732e09b5cecc874647603f40306d82a56, ef887e86b1973cbac2c3580e6ba584f488adeb1144550aec6054b8bd]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=d96b823ba1e4b22add39ec0a1db9a7c4fe01b4b72f2129733bea918c]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: 5c2202220a565b24a01fc9d2e9e02a7f45bc0ec4c6fe798961cf8eae5ebc654a
Expected policy IDs (from NFTs): [b048974bf7b5f074d8766b8ecac8625de85e44cfde4f1b5657af6c33]
Actual on-chain policy IDs:      [b048974bf7b5f074d8766b8ecac8625de85e44cfde4f1b5657af6c33]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: 95e3dbd57e64b9d030ed032a2b8ee0875b8c298e119576b2142c56992d2fb042
Logic hash - expected: 3312422df33f38c9c7827347c8ca383acddd53ac0da1175e7e8aa0b8, actual: 3312422df33f38c9c7827347c8ca383acddd53ac0da1175e7e8aa0b8 PASS
Auth hash (main_gov_auth) - expected: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff, actual: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: 4f785e13d0bb748721e6a4b7fdfae0c3cf6e1017cf5d474f4893345bfd2bb811
Logic hash - expected: 8c665fb2f97d1bca068e51e9c7534ecc56351271edc9c0106972e0a8, actual: 8c665fb2f97d1bca068e51e9c7534ecc56351271edc9c0106972e0a8 PASS
Auth hash (main_gov_auth) - expected: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff, actual: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 1dceb621dfc74cde3ba5520a5eea910d959a8fe855b1e89a43ca2a5f13ec0c6f
Logic hash - expected: 939b00ad9a65f081f9d7737321f48caef86803fd2bf893665c46bedb, actual: 939b00ad9a65f081f9d7737321f48caef86803fd2bf893665c46bedb PASS
Auth hash (main_gov_auth) - expected: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff, actual: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: b4a2acefc16e878d396b2dd999c2166f0d4a63aafd2fe54cef5752b7f9526956
Logic hash - expected: b86132f05d7304fc3a2d3b135756fddab38d45e549f57a691c2c80e8, actual: b86132f05d7304fc3a2d3b135756fddab38d45e549f57a691c2c80e8 PASS
Auth hash (main_gov_auth) - expected: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff, actual: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: a455337d1e105364e09f19dcbd37a95b0b8dd6f9517aa69630bad9eee3f8d733
Logic hash - expected: c76963dd635b1b88f438e3b4687ea3d80ee5ed9c4299eeddc2be9a62, actual: c76963dd635b1b88f438e3b4687ea3d80ee5ed9c4299eeddc2be9a62 PASS
Auth hash (main_gov_auth) - expected: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff, actual: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: d81714c8e0a530f894ad683eaecc50fde2106d1b618f6a0bc87c8b54178740ef
Logic hash - expected: d96b823ba1e4b22add39ec0a1db9a7c4fe01b4b72f2129733bea918c, actual: d96b823ba1e4b22add39ec0a1db9a7c4fe01b4b72f2129733bea918c PASS
Auth hash (main_gov_auth) - expected: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff, actual: c154035862147b743282718a68b200119b3e95ad67d76df7ad07f4ff PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: 95e3dbd57e64b9d030ed032a2b8ee0875b8c298e119576b2142c56992d2fb042
Logic hash - expected: 3312422df33f38c9c7827347c8ca383acddd53ac0da1175e7e8aa0b8, actual: 3312422df33f38c9c7827347c8ca383acddd53ac0da1175e7e8aa0b8 PASS
Auth hash (staging_gov_auth) - expected: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a, actual: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: 4f785e13d0bb748721e6a4b7fdfae0c3cf6e1017cf5d474f4893345bfd2bb811
Logic hash - expected: 8c665fb2f97d1bca068e51e9c7534ecc56351271edc9c0106972e0a8, actual: 8c665fb2f97d1bca068e51e9c7534ecc56351271edc9c0106972e0a8 PASS
Auth hash (staging_gov_auth) - expected: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a, actual: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 1dceb621dfc74cde3ba5520a5eea910d959a8fe855b1e89a43ca2a5f13ec0c6f
Logic hash - expected: 939b00ad9a65f081f9d7737321f48caef86803fd2bf893665c46bedb, actual: 939b00ad9a65f081f9d7737321f48caef86803fd2bf893665c46bedb PASS
Auth hash (staging_gov_auth) - expected: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a, actual: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: b4a2acefc16e878d396b2dd999c2166f0d4a63aafd2fe54cef5752b7f9526956
Logic hash - expected: b86132f05d7304fc3a2d3b135756fddab38d45e549f57a691c2c80e8, actual: b86132f05d7304fc3a2d3b135756fddab38d45e549f57a691c2c80e8 PASS
Auth hash (staging_gov_auth) - expected: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a, actual: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: a455337d1e105364e09f19dcbd37a95b0b8dd6f9517aa69630bad9eee3f8d733
Logic hash - expected: c76963dd635b1b88f438e3b4687ea3d80ee5ed9c4299eeddc2be9a62, actual: c76963dd635b1b88f438e3b4687ea3d80ee5ed9c4299eeddc2be9a62 PASS
Auth hash (staging_gov_auth) - expected: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a, actual: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: d81714c8e0a530f894ad683eaecc50fde2106d1b618f6a0bc87c8b54178740ef
Logic hash - expected: d96b823ba1e4b22add39ec0a1db9a7c4fe01b4b72f2129733bea918c, actual: d96b823ba1e4b22add39ec0a1db9a7c4fe01b4b72f2129733bea918c PASS
Auth hash (staging_gov_auth) - expected: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a, actual: d673c4dc29812525d6fbe0f9deef9698e2ed09b355277ba85e79dc3a PASS
```

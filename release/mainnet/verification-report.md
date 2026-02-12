# Deployment Verification Report

**Network:** mainnet
**Date:** 2026-02-12T22:39:48.502Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash 11d1de535579d929060a22828992802c77f329470adadaec10d2490c
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash e91becb9536df62eed161713311cc534ae909636ba9529b38e2a18f3
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash d24b012f7b2a99a671b7e1196847f183982d70db02ed37068e4e49e9
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 8f2c043f857c6acb716d27d67e9cb609c9c9814b7d7b938d6c410733
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash cb797228400c64a31a7a7053305f244a55af7602238e7428813f82ca
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 7240c79709cc225e621f8db67a86be9799015922f52b208a06aae48b
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: 82868cb4fb97b270945e4a86b933e8f3dcbd8adef6e903b8ba7fd87f02f62a1e
Expected policy IDs (from NFTs): [11d1de535579d929060a22828992802c77f329470adadaec10d2490c, f9bfa20ed6136305b654b3613bbe1c9a6f2f058fb61edee49bdf58be]
Actual on-chain policy IDs:      [11d1de535579d929060a22828992802c77f329470adadaec10d2490c, f9bfa20ed6136305b654b3613bbe1c9a6f2f058fb61edee49bdf58be]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=bc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d0]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 40fa3af464a18789ac0308acb4102f3dbbcd9f806c18008638523dc9dc634063
Expected policy IDs (from NFTs): [7c0017a835997df30a5907e361af383422e600ff07258ecfe6ba2d8d]
Actual on-chain policy IDs:      [7c0017a835997df30a5907e361af383422e600ff07258ecfe6ba2d8d]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: d707ea8f7381d395cc3c56c8950104069f4874c8b4044c5994e0b13ea7e48fef
Expected policy IDs (from NFTs): [911dee358e934f0ea32af5803586cbeee9721d20ab969f9fdff335ac, e91becb9536df62eed161713311cc534ae909636ba9529b38e2a18f3]
Actual on-chain policy IDs:      [911dee358e934f0ea32af5803586cbeee9721d20ab969f9fdff335ac, e91becb9536df62eed161713311cc534ae909636ba9529b38e2a18f3]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef9718]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: 9b06e15f40006e51a3ccf334705525d5e9e952c422b39c60e8d313f5943b0807
Expected policy IDs (from NFTs): [6ea88f2ab8bf86b4f9bff1e6663e2f9e72f913305e781d86f995f7b8]
Actual on-chain policy IDs:      [6ea88f2ab8bf86b4f9bff1e6663e2f9e72f913305e781d86f995f7b8]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: ddac4fc13e194185b39caea80ca00bb6d3d5b52155d8ff7a3896f8b344b2e2f2
Expected policy IDs (from NFTs): [68fc50469d13777fbc60491842ca3f80f07dc2d6542c551d9694ce9a, d24b012f7b2a99a671b7e1196847f183982d70db02ed37068e4e49e9]
Actual on-chain policy IDs:      [68fc50469d13777fbc60491842ca3f80f07dc2d6542c551d9694ce9a, d24b012f7b2a99a671b7e1196847f183982d70db02ed37068e4e49e9]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=bef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda]
```

### [PASS] On-chain: ics-deployment

```
Tx: 99377821b0b39f1a9e9b7d99ec701bfeb92fbc18cd4e732bc9dde66d994328a4
Expected policy IDs (from NFTs): [302484c99a6976063ad8e7aa5099ad95877f8cfe45a0dcc791abab6a, 8f2c043f857c6acb716d27d67e9cb609c9c9814b7d7b938d6c410733]
Actual on-chain policy IDs:      [302484c99a6976063ad8e7aa5099ad95877f8cfe45a0dcc791abab6a, 8f2c043f857c6acb716d27d67e9cb609c9c9814b7d7b938d6c410733]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=c4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 8ae50d9066a4c404f0e89cc5c732ba41f6b07e693f7f0d1d48cac2c41954a1a2
Expected policy IDs (from NFTs): [bd0d3863779d2e27dfc7bf8953ff49197900d8aef9e7ec4dca80e5e3]
Actual on-chain policy IDs:      [bd0d3863779d2e27dfc7bf8953ff49197900d8aef9e7ec4dca80e5e3]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 68058a74ec5438b99880673e621cb50e515a139a01e1da15b2fe8d43076b3100
Expected policy IDs (from NFTs): [08b27d7a74e2854c3024dfd9e2f9ad6318382ea80d85f904bb30df56]
Actual on-chain policy IDs:      [08b27d7a74e2854c3024dfd9e2f9ad6318382ea80d85f904bb30df56]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: cde897d5db4a515f2c366b8b35dc83247f53b307a87782a4edb784b04eb2715b
Expected policy IDs (from NFTs): [2c322542e32817f26a75bc49eaaf3ce831b62dafe4040e2f296e339a, cb797228400c64a31a7a7053305f244a55af7602238e7428813f82ca]
Actual on-chain policy IDs:      [2c322542e32817f26a75bc49eaaf3ce831b62dafe4040e2f296e339a, cb797228400c64a31a7a7053305f244a55af7602238e7428813f82ca]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=81920312b4a77e4b256e2de42b04582bc1862612d385587368be34a0]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: cbccb30e34ac451ddf383ecb6dc9c3055c0608aa33c412d36bfd7495c8bcfe0d
Expected policy IDs (from NFTs): [817173c0a1fdd73cb7db6a15c76004b8edd17da0cfe3146a60f5139f]
Actual on-chain policy IDs:      [817173c0a1fdd73cb7db6a15c76004b8edd17da0cfe3146a60f5139f]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: f9f521876b1843f0696b244ffafa40e662dfb38210ab858494eef05471a9f23f
Expected policy IDs (from NFTs): [7240c79709cc225e621f8db67a86be9799015922f52b208a06aae48b, a01f11b7a1c4c5b5c097d03bb503325e6b9911ed73a76549ef128f90]
Actual on-chain policy IDs:      [7240c79709cc225e621f8db67a86be9799015922f52b208a06aae48b, a01f11b7a1c4c5b5c097d03bb503325e6b9911ed73a76549ef128f90]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=9023e8962b3a917b9cb7de0e9786f7a8d2b2f0ee785b62404aa95314]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: 3a47fe43d963b196cd7bb525e97299b3936432df9310488c4d70d7ff0b8cc845
Expected policy IDs (from NFTs): [cedd09c3df53dc8f23de31e02134409eb8d215cd523e3dbaf9053190]
Actual on-chain policy IDs:      [cedd09c3df53dc8f23de31e02134409eb8d215cd523e3dbaf9053190]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: 82868cb4fb97b270945e4a86b933e8f3dcbd8adef6e903b8ba7fd87f02f62a1e
Logic hash - expected: bc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d0, actual: bc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d0 PASS
Auth hash (main_gov_auth) - expected: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c, actual: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: d707ea8f7381d395cc3c56c8950104069f4874c8b4044c5994e0b13ea7e48fef
Logic hash - expected: 8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef9718, actual: 8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef9718 PASS
Auth hash (main_gov_auth) - expected: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c, actual: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: ddac4fc13e194185b39caea80ca00bb6d3d5b52155d8ff7a3896f8b344b2e2f2
Logic hash - expected: bef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda, actual: bef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda PASS
Auth hash (main_gov_auth) - expected: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c, actual: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: 99377821b0b39f1a9e9b7d99ec701bfeb92fbc18cd4e732bc9dde66d994328a4
Logic hash - expected: c4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b, actual: c4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b PASS
Auth hash (main_gov_auth) - expected: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c, actual: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: cde897d5db4a515f2c366b8b35dc83247f53b307a87782a4edb784b04eb2715b
Logic hash - expected: 81920312b4a77e4b256e2de42b04582bc1862612d385587368be34a0, actual: 81920312b4a77e4b256e2de42b04582bc1862612d385587368be34a0 PASS
Auth hash (main_gov_auth) - expected: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c, actual: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: f9f521876b1843f0696b244ffafa40e662dfb38210ab858494eef05471a9f23f
Logic hash - expected: 9023e8962b3a917b9cb7de0e9786f7a8d2b2f0ee785b62404aa95314, actual: 9023e8962b3a917b9cb7de0e9786f7a8d2b2f0ee785b62404aa95314 PASS
Auth hash (main_gov_auth) - expected: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c, actual: 00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: 82868cb4fb97b270945e4a86b933e8f3dcbd8adef6e903b8ba7fd87f02f62a1e
Logic hash - expected: bc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d0, actual: bc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d0 PASS
Auth hash (staging_gov_auth) - expected: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d, actual: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: d707ea8f7381d395cc3c56c8950104069f4874c8b4044c5994e0b13ea7e48fef
Logic hash - expected: 8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef9718, actual: 8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef9718 PASS
Auth hash (staging_gov_auth) - expected: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d, actual: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: ddac4fc13e194185b39caea80ca00bb6d3d5b52155d8ff7a3896f8b344b2e2f2
Logic hash - expected: bef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda, actual: bef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda PASS
Auth hash (staging_gov_auth) - expected: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d, actual: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: 99377821b0b39f1a9e9b7d99ec701bfeb92fbc18cd4e732bc9dde66d994328a4
Logic hash - expected: c4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b, actual: c4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b PASS
Auth hash (staging_gov_auth) - expected: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d, actual: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: cde897d5db4a515f2c366b8b35dc83247f53b307a87782a4edb784b04eb2715b
Logic hash - expected: 81920312b4a77e4b256e2de42b04582bc1862612d385587368be34a0, actual: 81920312b4a77e4b256e2de42b04582bc1862612d385587368be34a0 PASS
Auth hash (staging_gov_auth) - expected: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d, actual: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: f9f521876b1843f0696b244ffafa40e662dfb38210ab858494eef05471a9f23f
Logic hash - expected: 9023e8962b3a917b9cb7de0e9786f7a8d2b2f0ee785b62404aa95314, actual: 9023e8962b3a917b9cb7de0e9786f7a8d2b2f0ee785b62404aa95314 PASS
Auth hash (staging_gov_auth) - expected: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d, actual: cf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d PASS
```

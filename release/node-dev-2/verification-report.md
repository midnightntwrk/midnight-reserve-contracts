# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-18T22:06:43.427Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash 477e8e7a2f05a90353a18e5b4f6c918741939bd7dc97d0e1c9c0efa7
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 98ff2a0e06d29b2b1d6a4134659a13329022a0c480be0df295fbddc0
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash bba0860d7e0b7d2c38cc5d2b03406ea7caa7a3f3d3a3a65aa5e62d41
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 39f27bb210e99b6aa67f5af37ee711388a51efa0278ba2a24ec061d5
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash 8a820a224ae9c60f94e21a249a88dd90937ce15445f384536c25ec08
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash ee091ab3706c13e11c85ff9b16df75c11e1e03ecc006852940a004ad
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: c6e620aea9b20645132c80faa4d297baf4b8ecaad1480146130b203efe4e3680
Expected policy IDs (from NFTs): [27f9aa4ed3624c015d065261caa7a0a7157e2e2a5aa9db73287326a1, 477e8e7a2f05a90353a18e5b4f6c918741939bd7dc97d0e1c9c0efa7]
Actual on-chain policy IDs:      [27f9aa4ed3624c015d065261caa7a0a7157e2e2a5aa9db73287326a1, 477e8e7a2f05a90353a18e5b4f6c918741939bd7dc97d0e1c9c0efa7]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=72a3fefad6c1188394d985ddff4a4aeba359ba176854241da5636f77]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: b6f5d1af98b75851be92385e5fda7da4e72397f31d22833effa6d125cef6c251
Expected policy IDs (from NFTs): [9cde9277b7ae83cef921fc89fadc214b1ffc5836ef03423088d2e6f3]
Actual on-chain policy IDs:      [9cde9277b7ae83cef921fc89fadc214b1ffc5836ef03423088d2e6f3]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: 0c11b8fbd98ae257033df826ccc4a6df437c80997981113ff34500e1c67b023f
Expected policy IDs (from NFTs): [0f01c6b5be4be2546d2095c4a94867be0976f687e2e1dc22c09bf8b1, 98ff2a0e06d29b2b1d6a4134659a13329022a0c480be0df295fbddc0]
Actual on-chain policy IDs:      [0f01c6b5be4be2546d2095c4a94867be0976f687e2e1dc22c09bf8b1, 98ff2a0e06d29b2b1d6a4134659a13329022a0c480be0df295fbddc0]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=c5b9de7bac823a4740353ae8b7f56e57af1c97e06122315cf1cf82fa]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: b443145ed5953213976c51708ded2381630c79c140b7b532d2091e0b13faa660
Expected policy IDs (from NFTs): [840879b6f409a2b4771c8427604ca9e5a7e882bf06d70b524a44cf71]
Actual on-chain policy IDs:      [840879b6f409a2b4771c8427604ca9e5a7e882bf06d70b524a44cf71]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 3ced851ec6b563c8d758391ce482a3feef9264bf823c9a4af1f92c2135f1a26c
Expected policy IDs (from NFTs): [bba0860d7e0b7d2c38cc5d2b03406ea7caa7a3f3d3a3a65aa5e62d41, d3d474acb21bd1e448673ba2a19e284b4e752f73f321ccd58c5b32c2]
Actual on-chain policy IDs:      [bba0860d7e0b7d2c38cc5d2b03406ea7caa7a3f3d3a3a65aa5e62d41, d3d474acb21bd1e448673ba2a19e284b4e752f73f321ccd58c5b32c2]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=aed91f80821b7ae39b9e5cb8880087021084fd0ee1a5ea785cddcdc9]
```

### [PASS] On-chain: ics-deployment

```
Tx: d772ac92a2dd56cfb6a4518e53f43a50d51354b586d13f083d5193ab5b86f2b8
Expected policy IDs (from NFTs): [39f27bb210e99b6aa67f5af37ee711388a51efa0278ba2a24ec061d5, 9995d97e277059be8d7c951d17b61ce5898cc917fad3f93d861a8de2]
Actual on-chain policy IDs:      [39f27bb210e99b6aa67f5af37ee711388a51efa0278ba2a24ec061d5, 9995d97e277059be8d7c951d17b61ce5898cc917fad3f93d861a8de2]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=404297b3aa2316585d239686860b1a6b600422aee9eeae8be1cc43c5]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 8e8d87c4fae5884221181e6fc3070f344290606edcd0618bd7bdbeddbb71d863
Expected policy IDs (from NFTs): [1bcad91b28f0384d46c7d0c7206e807304c2234678970490495f9fff]
Actual on-chain policy IDs:      [1bcad91b28f0384d46c7d0c7206e807304c2234678970490495f9fff]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 8c6f2a2ad0bbc4fb8237f0478d304c410318c90dc1fb5c9852826e4d16dc6ac2
Expected policy IDs (from NFTs): [f1a26cd6af974a9d1dfe07db8728d213ef31b918bb65105d8362c262]
Actual on-chain policy IDs:      [f1a26cd6af974a9d1dfe07db8728d213ef31b918bb65105d8362c262]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: f293e3efe481b6fa5fada318651c708eb649989bb7cf5ee28af0bdde728ef32c
Expected policy IDs (from NFTs): [8a820a224ae9c60f94e21a249a88dd90937ce15445f384536c25ec08, d80c9fbc4efc185bb3e8d60d3e20cf51eff471940fee72479d269122]
Actual on-chain policy IDs:      [8a820a224ae9c60f94e21a249a88dd90937ce15445f384536c25ec08, d80c9fbc4efc185bb3e8d60d3e20cf51eff471940fee72479d269122]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=1aa84995d59a54ab8dac9b345b396c88eb0e01257bd0663ad12312fa]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 471e8214401cd6de30db5f20ceaf30290573c933707cde0eaabd7671a57ae1e4
Expected policy IDs (from NFTs): [2560c23a5573e6bee2ec821fe86e82d0324ab017d707c51d514cd7d1]
Actual on-chain policy IDs:      [2560c23a5573e6bee2ec821fe86e82d0324ab017d707c51d514cd7d1]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 8a5d4bd0d0f00f75ee0ec97ed7fbc61ab3d94c8b7da8cc4992188ac6f7891f96
Expected policy IDs (from NFTs): [1e39e42d06fb03ce5eb2263a099315f6884158dee77f134099ea3ec2, ee091ab3706c13e11c85ff9b16df75c11e1e03ecc006852940a004ad]
Actual on-chain policy IDs:      [1e39e42d06fb03ce5eb2263a099315f6884158dee77f134099ea3ec2, ee091ab3706c13e11c85ff9b16df75c11e1e03ecc006852940a004ad]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=d67a139da001be7540a9865bace6caba08db1418b97e31f2beed4cfa]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: fd519e947597d9c5ea4973ce6adb50044397c254d2b9f81c7465624b09fc999c
Expected policy IDs (from NFTs): [4ebff37d4b9dc00e40b44898c3c6f900a24f5882aac8f67d2c65a172]
Actual on-chain policy IDs:      [4ebff37d4b9dc00e40b44898c3c6f900a24f5882aac8f67d2c65a172]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: c6e620aea9b20645132c80faa4d297baf4b8ecaad1480146130b203efe4e3680
Logic hash - expected: 72a3fefad6c1188394d985ddff4a4aeba359ba176854241da5636f77, actual: 72a3fefad6c1188394d985ddff4a4aeba359ba176854241da5636f77 PASS
Auth hash (main_gov_auth) - expected: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06, actual: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06 PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: 0c11b8fbd98ae257033df826ccc4a6df437c80997981113ff34500e1c67b023f
Logic hash - expected: c5b9de7bac823a4740353ae8b7f56e57af1c97e06122315cf1cf82fa, actual: c5b9de7bac823a4740353ae8b7f56e57af1c97e06122315cf1cf82fa PASS
Auth hash (main_gov_auth) - expected: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06, actual: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06 PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 3ced851ec6b563c8d758391ce482a3feef9264bf823c9a4af1f92c2135f1a26c
Logic hash - expected: aed91f80821b7ae39b9e5cb8880087021084fd0ee1a5ea785cddcdc9, actual: aed91f80821b7ae39b9e5cb8880087021084fd0ee1a5ea785cddcdc9 PASS
Auth hash (main_gov_auth) - expected: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06, actual: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06 PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: d772ac92a2dd56cfb6a4518e53f43a50d51354b586d13f083d5193ab5b86f2b8
Logic hash - expected: 404297b3aa2316585d239686860b1a6b600422aee9eeae8be1cc43c5, actual: 404297b3aa2316585d239686860b1a6b600422aee9eeae8be1cc43c5 PASS
Auth hash (main_gov_auth) - expected: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06, actual: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06 PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: f293e3efe481b6fa5fada318651c708eb649989bb7cf5ee28af0bdde728ef32c
Logic hash - expected: 1aa84995d59a54ab8dac9b345b396c88eb0e01257bd0663ad12312fa, actual: 1aa84995d59a54ab8dac9b345b396c88eb0e01257bd0663ad12312fa PASS
Auth hash (main_gov_auth) - expected: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06, actual: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06 PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 8a5d4bd0d0f00f75ee0ec97ed7fbc61ab3d94c8b7da8cc4992188ac6f7891f96
Logic hash - expected: d67a139da001be7540a9865bace6caba08db1418b97e31f2beed4cfa, actual: d67a139da001be7540a9865bace6caba08db1418b97e31f2beed4cfa PASS
Auth hash (main_gov_auth) - expected: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06, actual: 597339a5167ea00315766c728cf1fd8e3ab04e0705846c470ed56f06 PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: c6e620aea9b20645132c80faa4d297baf4b8ecaad1480146130b203efe4e3680
Logic hash - expected: 72a3fefad6c1188394d985ddff4a4aeba359ba176854241da5636f77, actual: 72a3fefad6c1188394d985ddff4a4aeba359ba176854241da5636f77 PASS
Auth hash (staging_gov_auth) - expected: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba, actual: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: 0c11b8fbd98ae257033df826ccc4a6df437c80997981113ff34500e1c67b023f
Logic hash - expected: c5b9de7bac823a4740353ae8b7f56e57af1c97e06122315cf1cf82fa, actual: c5b9de7bac823a4740353ae8b7f56e57af1c97e06122315cf1cf82fa PASS
Auth hash (staging_gov_auth) - expected: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba, actual: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 3ced851ec6b563c8d758391ce482a3feef9264bf823c9a4af1f92c2135f1a26c
Logic hash - expected: aed91f80821b7ae39b9e5cb8880087021084fd0ee1a5ea785cddcdc9, actual: aed91f80821b7ae39b9e5cb8880087021084fd0ee1a5ea785cddcdc9 PASS
Auth hash (staging_gov_auth) - expected: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba, actual: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: d772ac92a2dd56cfb6a4518e53f43a50d51354b586d13f083d5193ab5b86f2b8
Logic hash - expected: 404297b3aa2316585d239686860b1a6b600422aee9eeae8be1cc43c5, actual: 404297b3aa2316585d239686860b1a6b600422aee9eeae8be1cc43c5 PASS
Auth hash (staging_gov_auth) - expected: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba, actual: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: f293e3efe481b6fa5fada318651c708eb649989bb7cf5ee28af0bdde728ef32c
Logic hash - expected: 1aa84995d59a54ab8dac9b345b396c88eb0e01257bd0663ad12312fa, actual: 1aa84995d59a54ab8dac9b345b396c88eb0e01257bd0663ad12312fa PASS
Auth hash (staging_gov_auth) - expected: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba, actual: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 8a5d4bd0d0f00f75ee0ec97ed7fbc61ab3d94c8b7da8cc4992188ac6f7891f96
Logic hash - expected: d67a139da001be7540a9865bace6caba08db1418b97e31f2beed4cfa, actual: d67a139da001be7540a9865bace6caba08db1418b97e31f2beed4cfa PASS
Auth hash (staging_gov_auth) - expected: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba, actual: 789d5ce34faede76da956a4edcd88786ff35b814781ce19cc1b2f3ba PASS
```

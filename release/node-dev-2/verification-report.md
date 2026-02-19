# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-19T22:14:28.167Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash 5cbdc43e99448e7ac383be333673cf27e3f0499a4f2bed27e5b17667
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 788f5817c302709b32079d745110bc58ddc9f03ca39bb3e79f4e313d
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 0f186ff7226a385d607af24eda1012d093747982c8738e6039956840
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash cd5538eea965f50c1d36bcba7197c24893a59713d6d1e5ca4ebd558f
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash 9c04e67420ec7585ebddc7dce42460fa330c242231d353be0c4cf21b
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 870f036a268c868a2fb921fd1f66afad5c88403bef1e3603424d264f
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: 1e147e8cb537817933992f6835660a9dcd9b92db052eec25ab1977dd1115e1c3
Expected policy IDs (from NFTs): [5cbdc43e99448e7ac383be333673cf27e3f0499a4f2bed27e5b17667, cdc833a27c02569986012bfcfd823ee0ce148c264b59b1c3a43a1be9]
Actual on-chain policy IDs:      [5cbdc43e99448e7ac383be333673cf27e3f0499a4f2bed27e5b17667, cdc833a27c02569986012bfcfd823ee0ce148c264b59b1c3a43a1be9]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=ee96cdf577709dbb87b47a79ccf10f070563ac4c79f873f3af575d68]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 4a8270d0827e6ebecf0a78d2f2ea83895aac2f0cbec7747f8e480a2b07534631
Expected policy IDs (from NFTs): [445056955fbefbf3d8806e0b2b720feaa6a13d8a13349a28f7f0e22c]
Actual on-chain policy IDs:      [445056955fbefbf3d8806e0b2b720feaa6a13d8a13349a28f7f0e22c]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: 580d9872fd8ca8583eb1aa410467bf9f85d8ec942bc6a82b656f97095939348a
Expected policy IDs (from NFTs): [788f5817c302709b32079d745110bc58ddc9f03ca39bb3e79f4e313d, c42a6688eacfe60e06d3e3d86709fc38f2912ca1b58e7d98c27d856f]
Actual on-chain policy IDs:      [788f5817c302709b32079d745110bc58ddc9f03ca39bb3e79f4e313d, c42a6688eacfe60e06d3e3d86709fc38f2912ca1b58e7d98c27d856f]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=8d6178822292ca136a9dc84839b84b102d2e82242180f975a7d90e5c]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: 592053a5b2004a13ffc9230f8e72290d3c7298a82d267e9783309df22e70cd7c
Expected policy IDs (from NFTs): [872fe19662c2d7fc2ad274df72d441bd1586a61596edb7d1be81f742]
Actual on-chain policy IDs:      [872fe19662c2d7fc2ad274df72d441bd1586a61596edb7d1be81f742]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 405b3b352ee9e35b7736de25ae3971f5fd67f7de496d4190a1cdcfbd49c6c0b3
Expected policy IDs (from NFTs): [0f186ff7226a385d607af24eda1012d093747982c8738e6039956840, 1dbff7df1e5eb077fc21f314b026f73c08aebbbc9883c0d8f61987b9]
Actual on-chain policy IDs:      [0f186ff7226a385d607af24eda1012d093747982c8738e6039956840, 1dbff7df1e5eb077fc21f314b026f73c08aebbbc9883c0d8f61987b9]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=6d41acc8f80ddbe171838884728a6d3bd8f21f0209ab6222f5a31fb2]
```

### [PASS] On-chain: ics-deployment

```
Tx: d124d2badfd12dcfa2f4451881abace854f1fe0d994eafcc13f3768215acff62
Expected policy IDs (from NFTs): [2c631ccbd32e966dd6d7dd74a8b773eb55e5c4275c864048eaadbae1, cd5538eea965f50c1d36bcba7197c24893a59713d6d1e5ca4ebd558f]
Actual on-chain policy IDs:      [2c631ccbd32e966dd6d7dd74a8b773eb55e5c4275c864048eaadbae1, cd5538eea965f50c1d36bcba7197c24893a59713d6d1e5ca4ebd558f]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=96f52d352dda10f8e6833a240c2e50515a018456c039be801ccd8131]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 9c49f244fca012c9b8155dfb42ad7003a0473d1a2a5d4852d62ad8e22964c96f
Expected policy IDs (from NFTs): [1ee8be2cb94305f53a5a58373e5be309a3d8f0bbf0e7ece818f7fefb]
Actual on-chain policy IDs:      [1ee8be2cb94305f53a5a58373e5be309a3d8f0bbf0e7ece818f7fefb]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 3a1ee3f1b3cc1e0fe81785f3a0401486cbeb2730d062dfd994845fc1ab4915f0
Expected policy IDs (from NFTs): [8d7c8063cfba209d54041dfd5535812c3ab54ac3d2bc4cac45314378]
Actual on-chain policy IDs:      [8d7c8063cfba209d54041dfd5535812c3ab54ac3d2bc4cac45314378]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 46e0d1f21d46ce3a72d0c50c691a86a0f2501ad07a4360099178028677b48be9
Expected policy IDs (from NFTs): [9c04e67420ec7585ebddc7dce42460fa330c242231d353be0c4cf21b, fd04b068d5fb37c0dd1e55a196e9308d53fe8d6071682d48077af87a]
Actual on-chain policy IDs:      [9c04e67420ec7585ebddc7dce42460fa330c242231d353be0c4cf21b, fd04b068d5fb37c0dd1e55a196e9308d53fe8d6071682d48077af87a]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=fb7164815adb843bf21a4fb5a2242f8796d80faea63ca7032d2ff27d]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 7004e01b1829d0861fa84a333a3ee92ae6100e42571eeb3dc9575c5739eaa365
Expected policy IDs (from NFTs): [571d10fce29fc84cb109e81f2613b4201ff6a70011e64601a13041a4]
Actual on-chain policy IDs:      [571d10fce29fc84cb109e81f2613b4201ff6a70011e64601a13041a4]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 12ce3650447e5f6b10586e37d3fe20cfb7e5f5a907720d270066236297e004bc
Expected policy IDs (from NFTs): [454509351316f525f984369884a345c00c5b7321ef113ae98b74ebff, 870f036a268c868a2fb921fd1f66afad5c88403bef1e3603424d264f]
Actual on-chain policy IDs:      [454509351316f525f984369884a345c00c5b7321ef113ae98b74ebff, 870f036a268c868a2fb921fd1f66afad5c88403bef1e3603424d264f]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=d7f5053cbb25647dc3f4c94aacda072a66dec0083b647a2c0ea7b777]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: 5fc56c38f0015b54f89c80b35eadac6f4f2c2f5814574e9c0fab8bc137b1fba4
Expected policy IDs (from NFTs): [0aefde89d9d2b66eeab9c3d48510fb147be54c66f0cc1403d7b2583a]
Actual on-chain policy IDs:      [0aefde89d9d2b66eeab9c3d48510fb147be54c66f0cc1403d7b2583a]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: 1e147e8cb537817933992f6835660a9dcd9b92db052eec25ab1977dd1115e1c3
Logic hash - expected: ee96cdf577709dbb87b47a79ccf10f070563ac4c79f873f3af575d68, actual: ee96cdf577709dbb87b47a79ccf10f070563ac4c79f873f3af575d68 PASS
Auth hash (main_gov_auth) - expected: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01, actual: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01 PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: 580d9872fd8ca8583eb1aa410467bf9f85d8ec942bc6a82b656f97095939348a
Logic hash - expected: 8d6178822292ca136a9dc84839b84b102d2e82242180f975a7d90e5c, actual: 8d6178822292ca136a9dc84839b84b102d2e82242180f975a7d90e5c PASS
Auth hash (main_gov_auth) - expected: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01, actual: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01 PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 405b3b352ee9e35b7736de25ae3971f5fd67f7de496d4190a1cdcfbd49c6c0b3
Logic hash - expected: 6d41acc8f80ddbe171838884728a6d3bd8f21f0209ab6222f5a31fb2, actual: 6d41acc8f80ddbe171838884728a6d3bd8f21f0209ab6222f5a31fb2 PASS
Auth hash (main_gov_auth) - expected: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01, actual: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01 PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: d124d2badfd12dcfa2f4451881abace854f1fe0d994eafcc13f3768215acff62
Logic hash - expected: 96f52d352dda10f8e6833a240c2e50515a018456c039be801ccd8131, actual: 96f52d352dda10f8e6833a240c2e50515a018456c039be801ccd8131 PASS
Auth hash (main_gov_auth) - expected: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01, actual: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01 PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 46e0d1f21d46ce3a72d0c50c691a86a0f2501ad07a4360099178028677b48be9
Logic hash - expected: fb7164815adb843bf21a4fb5a2242f8796d80faea63ca7032d2ff27d, actual: fb7164815adb843bf21a4fb5a2242f8796d80faea63ca7032d2ff27d PASS
Auth hash (main_gov_auth) - expected: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01, actual: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01 PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 12ce3650447e5f6b10586e37d3fe20cfb7e5f5a907720d270066236297e004bc
Logic hash - expected: d7f5053cbb25647dc3f4c94aacda072a66dec0083b647a2c0ea7b777, actual: d7f5053cbb25647dc3f4c94aacda072a66dec0083b647a2c0ea7b777 PASS
Auth hash (main_gov_auth) - expected: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01, actual: ba96a0accdf6dcc3398d0bb6eb39d9c6a0d377dad282835d192aba01 PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: 1e147e8cb537817933992f6835660a9dcd9b92db052eec25ab1977dd1115e1c3
Logic hash - expected: ee96cdf577709dbb87b47a79ccf10f070563ac4c79f873f3af575d68, actual: ee96cdf577709dbb87b47a79ccf10f070563ac4c79f873f3af575d68 PASS
Auth hash (staging_gov_auth) - expected: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc, actual: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: 580d9872fd8ca8583eb1aa410467bf9f85d8ec942bc6a82b656f97095939348a
Logic hash - expected: 8d6178822292ca136a9dc84839b84b102d2e82242180f975a7d90e5c, actual: 8d6178822292ca136a9dc84839b84b102d2e82242180f975a7d90e5c PASS
Auth hash (staging_gov_auth) - expected: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc, actual: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 405b3b352ee9e35b7736de25ae3971f5fd67f7de496d4190a1cdcfbd49c6c0b3
Logic hash - expected: 6d41acc8f80ddbe171838884728a6d3bd8f21f0209ab6222f5a31fb2, actual: 6d41acc8f80ddbe171838884728a6d3bd8f21f0209ab6222f5a31fb2 PASS
Auth hash (staging_gov_auth) - expected: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc, actual: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: d124d2badfd12dcfa2f4451881abace854f1fe0d994eafcc13f3768215acff62
Logic hash - expected: 96f52d352dda10f8e6833a240c2e50515a018456c039be801ccd8131, actual: 96f52d352dda10f8e6833a240c2e50515a018456c039be801ccd8131 PASS
Auth hash (staging_gov_auth) - expected: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc, actual: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 46e0d1f21d46ce3a72d0c50c691a86a0f2501ad07a4360099178028677b48be9
Logic hash - expected: fb7164815adb843bf21a4fb5a2242f8796d80faea63ca7032d2ff27d, actual: fb7164815adb843bf21a4fb5a2242f8796d80faea63ca7032d2ff27d PASS
Auth hash (staging_gov_auth) - expected: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc, actual: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 12ce3650447e5f6b10586e37d3fe20cfb7e5f5a907720d270066236297e004bc
Logic hash - expected: d7f5053cbb25647dc3f4c94aacda072a66dec0083b647a2c0ea7b777, actual: d7f5053cbb25647dc3f4c94aacda072a66dec0083b647a2c0ea7b777 PASS
Auth hash (staging_gov_auth) - expected: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc, actual: 645c0fea0e41b1fd9313a858a4594a9708ab0a10e210d4618f9b0ebc PASS
```

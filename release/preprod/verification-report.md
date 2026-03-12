# Deployment Verification Report

**Network:** preprod
**Date:** 2026-03-12T17:52:53.177Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash d4e2fffdc67c5cc656288a8037310a8cd9e1424105368f96025d97fa
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash f8390fac17f251e72dafdcffcceacd4e5e8226661b676384c14bd70b
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 58a7c361ad3d845269bb8347c9c9317dfe80fb7d25d91be0393e34e3
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 66e192fad4736c8d8f5213311f4e8ab867d2c24be7a167c77b031259
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash 4f58ddcb5f16f82eea66c7292650c0160f70555845355564fcb73828
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash c15a86b332a164045f073f058829bbd8500797076950b6ebaa50641c
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: 830385b76d6d8f5c8fc3c65207adff20821ecb1e6022ee2a1548c2319d608226
Expected policy IDs (from NFTs): [62905eebf02b600a8c5f5b3d3fc17daefc7add85a92eb004158bae77, d4e2fffdc67c5cc656288a8037310a8cd9e1424105368f96025d97fa]
Actual on-chain policy IDs:      [62905eebf02b600a8c5f5b3d3fc17daefc7add85a92eb004158bae77, d4e2fffdc67c5cc656288a8037310a8cd9e1424105368f96025d97fa]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=fe96d0c8f9a8b060de057a2be03ecbf02c7f040ec1c2a0017298d42f]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: be77d7fada997b395591f170c67f02b109e924cb7e3a71b9ee78689607bafe52
Expected policy IDs (from NFTs): [1e077c8192b60345fb9f5b14a213d4ca7b13daec4014caa772cef0db]
Actual on-chain policy IDs:      [1e077c8192b60345fb9f5b14a213d4ca7b13daec4014caa772cef0db]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: 66394eaff3ed034e74e57df59a1fc844a0289400d368664a7cd0901b20f0d47f
Expected policy IDs (from NFTs): [bdace6f5897301896f7debbf5b386d6997e4558c12377be3ecb22ce8, f8390fac17f251e72dafdcffcceacd4e5e8226661b676384c14bd70b]
Actual on-chain policy IDs:      [bdace6f5897301896f7debbf5b386d6997e4558c12377be3ecb22ce8, f8390fac17f251e72dafdcffcceacd4e5e8226661b676384c14bd70b]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=676d845f1a48ce9712875eb8367188e9b5d462c5edc37fb7ae52a483]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: 18532c0b66f546af3aa7216a56b64dec6ce899bd3d925aced0373012503f2ed8
Expected policy IDs (from NFTs): [8a129056d1f4eb63153550ead02e9845ca23ee27d4c3d1856da889de]
Actual on-chain policy IDs:      [8a129056d1f4eb63153550ead02e9845ca23ee27d4c3d1856da889de]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: ed8a1f6afb4cb2b10e37e1092601a20a021da7231faafe10816f3c56bc3532d0
Expected policy IDs (from NFTs): [58a7c361ad3d845269bb8347c9c9317dfe80fb7d25d91be0393e34e3, fb964a2751bb9cb9c7a6d1475d1ea4a3960820a0f318883647502426]
Actual on-chain policy IDs:      [58a7c361ad3d845269bb8347c9c9317dfe80fb7d25d91be0393e34e3, fb964a2751bb9cb9c7a6d1475d1ea4a3960820a0f318883647502426]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=02a170c622abcecae48a6a521961daaeb810c193d39a1326c0041a35]
```

### [PASS] On-chain: ics-deployment

```
Tx: 725c21c20c9193fe813d98cf886cd9e5e40187ac18cfc3be6e30bb349cbc90b4
Expected policy IDs (from NFTs): [475db387ba92282a387e9ddfb7f8d2fd297f9b660450005f3ed37550, 66e192fad4736c8d8f5213311f4e8ab867d2c24be7a167c77b031259]
Actual on-chain policy IDs:      [475db387ba92282a387e9ddfb7f8d2fd297f9b660450005f3ed37550, 66e192fad4736c8d8f5213311f4e8ab867d2c24be7a167c77b031259]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=ce3d3ffb059203ec864a53bffe26801d845e8d6dcea332999831d4f6]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: dae308b983b0c20652b0cd2905014f3e342ad98e0ae74eb0ae0e614ab31ed7a1
Expected policy IDs (from NFTs): [52445f9fcdcfc6afba6f4721254c35553ebb01e16b19f19f0fe25e0b]
Actual on-chain policy IDs:      [52445f9fcdcfc6afba6f4721254c35553ebb01e16b19f19f0fe25e0b]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 910a876444dfbc0e72368bc629a28fa88838364db446caa7eae785e0db12f36d
Expected policy IDs (from NFTs): [c68cce5447495c19611096c5f4465b2410bd7cb87c2b48b4e63fe5a9]
Actual on-chain policy IDs:      [c68cce5447495c19611096c5f4465b2410bd7cb87c2b48b4e63fe5a9]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 6febb132b49853f2bf351ad9354bfc40d101a82322d6d14180d0b11b5b456077
Expected policy IDs (from NFTs): [4f58ddcb5f16f82eea66c7292650c0160f70555845355564fcb73828, d962fc619efb2b904e5a8443838500ef2145452af117ab8f9cc3f97f]
Actual on-chain policy IDs:      [4f58ddcb5f16f82eea66c7292650c0160f70555845355564fcb73828, d962fc619efb2b904e5a8443838500ef2145452af117ab8f9cc3f97f]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=c97974001ac80c78eb84d36e6366091f2fd446e4f04cd14588c0b3c3]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 3d6bd7dc0c7452e970e93f91683711068ba4a0e42d6895137cbd7d3d8f908574
Expected policy IDs (from NFTs): [f2cbeca6437dd91c9b281abd35662497124891287f49767f47bab7ae]
Actual on-chain policy IDs:      [f2cbeca6437dd91c9b281abd35662497124891287f49767f47bab7ae]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 41aa1c03bfba27801bf2fe1274f3eceaa9d46098e1e96d73556ae0b309af575d
Expected policy IDs (from NFTs): [6b4ed8c066d328c80b45678410025bb8427b9b6e00034b9c53989331, c15a86b332a164045f073f058829bbd8500797076950b6ebaa50641c]
Actual on-chain policy IDs:      [6b4ed8c066d328c80b45678410025bb8427b9b6e00034b9c53989331, c15a86b332a164045f073f058829bbd8500797076950b6ebaa50641c]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=508eb0e9a60aefa1835a2d74c0a697474e4f01d7dfba9d4c5c90b361]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: e0a3fc813ceaee1a5714181c2520b30bbfc41d21eff4f4bd24e4d1ccb5364608
Expected policy IDs (from NFTs): [834dadba59cad9d297b9d729d5723b3236c28b4232f5a5780b1e1c0f]
Actual on-chain policy IDs:      [834dadba59cad9d297b9d729d5723b3236c28b4232f5a5780b1e1c0f]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: 830385b76d6d8f5c8fc3c65207adff20821ecb1e6022ee2a1548c2319d608226
Logic hash - expected: fe96d0c8f9a8b060de057a2be03ecbf02c7f040ec1c2a0017298d42f, actual: fe96d0c8f9a8b060de057a2be03ecbf02c7f040ec1c2a0017298d42f PASS
Auth hash (main_gov_auth) - expected: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3, actual: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3 PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: 66394eaff3ed034e74e57df59a1fc844a0289400d368664a7cd0901b20f0d47f
Logic hash - expected: 676d845f1a48ce9712875eb8367188e9b5d462c5edc37fb7ae52a483, actual: 676d845f1a48ce9712875eb8367188e9b5d462c5edc37fb7ae52a483 PASS
Auth hash (main_gov_auth) - expected: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3, actual: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3 PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: ed8a1f6afb4cb2b10e37e1092601a20a021da7231faafe10816f3c56bc3532d0
Logic hash - expected: 02a170c622abcecae48a6a521961daaeb810c193d39a1326c0041a35, actual: 02a170c622abcecae48a6a521961daaeb810c193d39a1326c0041a35 PASS
Auth hash (main_gov_auth) - expected: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3, actual: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3 PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: 725c21c20c9193fe813d98cf886cd9e5e40187ac18cfc3be6e30bb349cbc90b4
Logic hash - expected: ce3d3ffb059203ec864a53bffe26801d845e8d6dcea332999831d4f6, actual: ce3d3ffb059203ec864a53bffe26801d845e8d6dcea332999831d4f6 PASS
Auth hash (main_gov_auth) - expected: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3, actual: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3 PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 6febb132b49853f2bf351ad9354bfc40d101a82322d6d14180d0b11b5b456077
Logic hash - expected: c97974001ac80c78eb84d36e6366091f2fd446e4f04cd14588c0b3c3, actual: c97974001ac80c78eb84d36e6366091f2fd446e4f04cd14588c0b3c3 PASS
Auth hash (main_gov_auth) - expected: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3, actual: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3 PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 41aa1c03bfba27801bf2fe1274f3eceaa9d46098e1e96d73556ae0b309af575d
Logic hash - expected: 508eb0e9a60aefa1835a2d74c0a697474e4f01d7dfba9d4c5c90b361, actual: 508eb0e9a60aefa1835a2d74c0a697474e4f01d7dfba9d4c5c90b361 PASS
Auth hash (main_gov_auth) - expected: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3, actual: b71c4f47f6a8407d5d6b19eb846261282bbe73bbac277fa8d0dd75b3 PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: 830385b76d6d8f5c8fc3c65207adff20821ecb1e6022ee2a1548c2319d608226
Logic hash - expected: fe96d0c8f9a8b060de057a2be03ecbf02c7f040ec1c2a0017298d42f, actual: fe96d0c8f9a8b060de057a2be03ecbf02c7f040ec1c2a0017298d42f PASS
Auth hash (staging_gov_auth) - expected: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed, actual: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: 66394eaff3ed034e74e57df59a1fc844a0289400d368664a7cd0901b20f0d47f
Logic hash - expected: 676d845f1a48ce9712875eb8367188e9b5d462c5edc37fb7ae52a483, actual: 676d845f1a48ce9712875eb8367188e9b5d462c5edc37fb7ae52a483 PASS
Auth hash (staging_gov_auth) - expected: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed, actual: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: ed8a1f6afb4cb2b10e37e1092601a20a021da7231faafe10816f3c56bc3532d0
Logic hash - expected: 02a170c622abcecae48a6a521961daaeb810c193d39a1326c0041a35, actual: 02a170c622abcecae48a6a521961daaeb810c193d39a1326c0041a35 PASS
Auth hash (staging_gov_auth) - expected: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed, actual: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: 725c21c20c9193fe813d98cf886cd9e5e40187ac18cfc3be6e30bb349cbc90b4
Logic hash - expected: ce3d3ffb059203ec864a53bffe26801d845e8d6dcea332999831d4f6, actual: ce3d3ffb059203ec864a53bffe26801d845e8d6dcea332999831d4f6 PASS
Auth hash (staging_gov_auth) - expected: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed, actual: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 6febb132b49853f2bf351ad9354bfc40d101a82322d6d14180d0b11b5b456077
Logic hash - expected: c97974001ac80c78eb84d36e6366091f2fd446e4f04cd14588c0b3c3, actual: c97974001ac80c78eb84d36e6366091f2fd446e4f04cd14588c0b3c3 PASS
Auth hash (staging_gov_auth) - expected: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed, actual: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 41aa1c03bfba27801bf2fe1274f3eceaa9d46098e1e96d73556ae0b309af575d
Logic hash - expected: 508eb0e9a60aefa1835a2d74c0a697474e4f01d7dfba9d4c5c90b361, actual: 508eb0e9a60aefa1835a2d74c0a697474e4f01d7dfba9d4c5c90b361 PASS
Auth hash (staging_gov_auth) - expected: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed, actual: 293751f30b28a1fa30fcbd39f2570ea96d18cbe7b118acfcc2df4fed PASS
```

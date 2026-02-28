# Deployment Verification Report

**Network:** node-dev-3
**Date:** 2026-02-28T01:44:32.616Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash f547940d8613c9948c2a9a8d11ff0d3a823e5906dda736f404691be3
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 01cf1df18bd5f8c501a085133929990417bf43ca50abf18166f5aef2
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash a0e7c82c50e7fd91d6c5da3a26db097401c46fb1a1c127dba7a4b2a3
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash d240e9984832108f3b11607d138d4d6f5f49f8f7032e4cbc09848f50
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash fe80c728c464d505723e2146f554d2545d34899b7ebabecfc3080dc0
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 10a58d58e015ef46b2a771a64f41f67cf04d3e5542373d20c7cd743a
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: 6a0ff6c8ac79acf365c2599fbd38e354a2658a400b35938dd2a80be2ca9db66e
Expected policy IDs (from NFTs): [6d2c9d20de6c790a0d1c1e4cb830af7903a337d7398ec6eed89453c0, f547940d8613c9948c2a9a8d11ff0d3a823e5906dda736f404691be3]
Actual on-chain policy IDs:      [6d2c9d20de6c790a0d1c1e4cb830af7903a337d7398ec6eed89453c0, f547940d8613c9948c2a9a8d11ff0d3a823e5906dda736f404691be3]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=5f0c0a15b736cf51f27743ed165c04296a02fa6c44d07ea36709bc98]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: d6ca79e1b467aa3b6cb074924fbdda6d949c1d63c485b2f4373cb65b44a28981
Expected policy IDs (from NFTs): [be7c7ffe7b644152979f60aa81dcfcaba81938388d4e1681c0577ff4]
Actual on-chain policy IDs:      [be7c7ffe7b644152979f60aa81dcfcaba81938388d4e1681c0577ff4]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: 9f2cc6f81e3781259444f73774da9022ca7e726f63cb1fafccd76d3b98334f70
Expected policy IDs (from NFTs): [01cf1df18bd5f8c501a085133929990417bf43ca50abf18166f5aef2, 378422d19bb284dcf6b61bb58b213f2fa9b457effa83e2afd278f717]
Actual on-chain policy IDs:      [01cf1df18bd5f8c501a085133929990417bf43ca50abf18166f5aef2, 378422d19bb284dcf6b61bb58b213f2fa9b457effa83e2afd278f717]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=0f3ee95a66939673315eedd67db507caeeeac3e3bb330b88a518f611]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: cdcd4322cf92ea7dae54f72b4e30e43675e39ed2474f2c9fa028ef820aecc0b6
Expected policy IDs (from NFTs): [1b22c81ed62f96da370d7fb50ce4cda1b70951133b09ee889b035770]
Actual on-chain policy IDs:      [1b22c81ed62f96da370d7fb50ce4cda1b70951133b09ee889b035770]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 1c44540dae316870706387f22c9d85de1ba3a49ea5ce805e297adebe4bf2e1ed
Expected policy IDs (from NFTs): [3cbfe426733c476b39f78ffdbda9456612e2c79e07bb5d34584399cb, a0e7c82c50e7fd91d6c5da3a26db097401c46fb1a1c127dba7a4b2a3]
Actual on-chain policy IDs:      [3cbfe426733c476b39f78ffdbda9456612e2c79e07bb5d34584399cb, a0e7c82c50e7fd91d6c5da3a26db097401c46fb1a1c127dba7a4b2a3]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=c9fabaad6e641f78373bca9d14f7f23afd68b45035d2d15edd01fb43]
```

### [PASS] On-chain: ics-deployment

```
Tx: 69b18814ccfcc81f3cf3eeeac56d6daab0fe5447ce4075d6b870d581e4b63f02
Expected policy IDs (from NFTs): [95e49c0a11c83434107a530bfbe16ef897c788a794b2ede4f679089e, d240e9984832108f3b11607d138d4d6f5f49f8f7032e4cbc09848f50]
Actual on-chain policy IDs:      [95e49c0a11c83434107a530bfbe16ef897c788a794b2ede4f679089e, d240e9984832108f3b11607d138d4d6f5f49f8f7032e4cbc09848f50]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=acec033e3a3089d48842ca8653750acb3f69eba26d59d4d51dec45be]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: f3dd53fad1a8668ca8915e7e2a33d12e1ade21f8f933963ce4331bb3bac3c23c
Expected policy IDs (from NFTs): [2b2bf4e76ec92418601104baab91fe0011db56f2335c79370b78cba2]
Actual on-chain policy IDs:      [2b2bf4e76ec92418601104baab91fe0011db56f2335c79370b78cba2]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 4eb8d85059ab95f5db9e16e4d0bee3eb4246be01d19777f178758ffd191f7734
Expected policy IDs (from NFTs): [5a4e8553423f4999dee89560d7ff8c4ec027a3a0a59025b473683ef1]
Actual on-chain policy IDs:      [5a4e8553423f4999dee89560d7ff8c4ec027a3a0a59025b473683ef1]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: a0d97a34a67cb505a7926926c33927578a5e2ba1946e5a9e7c1f9e91084f096c
Expected policy IDs (from NFTs): [5d357222443a56ca97623ccf0cd0e0fc3423af0985a2eecaa7fc5a8c, fe80c728c464d505723e2146f554d2545d34899b7ebabecfc3080dc0]
Actual on-chain policy IDs:      [5d357222443a56ca97623ccf0cd0e0fc3423af0985a2eecaa7fc5a8c, fe80c728c464d505723e2146f554d2545d34899b7ebabecfc3080dc0]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=078834e32fd4107b050411b29986fbfbafd2a8c782ab005e269ed132]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: b43e255bdff24045bffe74730e772891ad8800aee30ac8c1a3257e54db7a2382
Expected policy IDs (from NFTs): [1ce15bdd902df814be97dc801d8a5cf10c5f7e28bbf7d9ef81a907f7]
Actual on-chain policy IDs:      [1ce15bdd902df814be97dc801d8a5cf10c5f7e28bbf7d9ef81a907f7]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 39a96e1e36ec41e8dfcc368e76abc52c0156758beb95b0f2538eb9594bb07771
Expected policy IDs (from NFTs): [10a58d58e015ef46b2a771a64f41f67cf04d3e5542373d20c7cd743a, 4181ac65d862fd5d8eb4833a8dc731e3f5da383a6e39a47018943340]
Actual on-chain policy IDs:      [10a58d58e015ef46b2a771a64f41f67cf04d3e5542373d20c7cd743a, 4181ac65d862fd5d8eb4833a8dc731e3f5da383a6e39a47018943340]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=a7da620e68d07f8f49cd843d4b22f9b62e7ac4558cd156370084bffb]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: cae67960d94d8bf11e0ebbce30c888ddef7f4416d8f68ea6426a0b5d198b4b08
Expected policy IDs (from NFTs): [46a5ecd0246730fc194baa0c3d81fce9b84846f2eb734ca336ff478f]
Actual on-chain policy IDs:      [46a5ecd0246730fc194baa0c3d81fce9b84846f2eb734ca336ff478f]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: 6a0ff6c8ac79acf365c2599fbd38e354a2658a400b35938dd2a80be2ca9db66e
Logic hash - expected: 5f0c0a15b736cf51f27743ed165c04296a02fa6c44d07ea36709bc98, actual: 5f0c0a15b736cf51f27743ed165c04296a02fa6c44d07ea36709bc98 PASS
Auth hash (main_gov_auth) - expected: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18, actual: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18 PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: 9f2cc6f81e3781259444f73774da9022ca7e726f63cb1fafccd76d3b98334f70
Logic hash - expected: 0f3ee95a66939673315eedd67db507caeeeac3e3bb330b88a518f611, actual: 0f3ee95a66939673315eedd67db507caeeeac3e3bb330b88a518f611 PASS
Auth hash (main_gov_auth) - expected: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18, actual: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18 PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 1c44540dae316870706387f22c9d85de1ba3a49ea5ce805e297adebe4bf2e1ed
Logic hash - expected: c9fabaad6e641f78373bca9d14f7f23afd68b45035d2d15edd01fb43, actual: c9fabaad6e641f78373bca9d14f7f23afd68b45035d2d15edd01fb43 PASS
Auth hash (main_gov_auth) - expected: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18, actual: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18 PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: 69b18814ccfcc81f3cf3eeeac56d6daab0fe5447ce4075d6b870d581e4b63f02
Logic hash - expected: acec033e3a3089d48842ca8653750acb3f69eba26d59d4d51dec45be, actual: acec033e3a3089d48842ca8653750acb3f69eba26d59d4d51dec45be PASS
Auth hash (main_gov_auth) - expected: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18, actual: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18 PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: a0d97a34a67cb505a7926926c33927578a5e2ba1946e5a9e7c1f9e91084f096c
Logic hash - expected: 078834e32fd4107b050411b29986fbfbafd2a8c782ab005e269ed132, actual: 078834e32fd4107b050411b29986fbfbafd2a8c782ab005e269ed132 PASS
Auth hash (main_gov_auth) - expected: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18, actual: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18 PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 39a96e1e36ec41e8dfcc368e76abc52c0156758beb95b0f2538eb9594bb07771
Logic hash - expected: a7da620e68d07f8f49cd843d4b22f9b62e7ac4558cd156370084bffb, actual: a7da620e68d07f8f49cd843d4b22f9b62e7ac4558cd156370084bffb PASS
Auth hash (main_gov_auth) - expected: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18, actual: 464d4fc8374a2977bbb19459b66ccc5b912909bacd3e50445112ba18 PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: 6a0ff6c8ac79acf365c2599fbd38e354a2658a400b35938dd2a80be2ca9db66e
Logic hash - expected: 5f0c0a15b736cf51f27743ed165c04296a02fa6c44d07ea36709bc98, actual: 5f0c0a15b736cf51f27743ed165c04296a02fa6c44d07ea36709bc98 PASS
Auth hash (staging_gov_auth) - expected: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf, actual: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: 9f2cc6f81e3781259444f73774da9022ca7e726f63cb1fafccd76d3b98334f70
Logic hash - expected: 0f3ee95a66939673315eedd67db507caeeeac3e3bb330b88a518f611, actual: 0f3ee95a66939673315eedd67db507caeeeac3e3bb330b88a518f611 PASS
Auth hash (staging_gov_auth) - expected: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf, actual: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 1c44540dae316870706387f22c9d85de1ba3a49ea5ce805e297adebe4bf2e1ed
Logic hash - expected: c9fabaad6e641f78373bca9d14f7f23afd68b45035d2d15edd01fb43, actual: c9fabaad6e641f78373bca9d14f7f23afd68b45035d2d15edd01fb43 PASS
Auth hash (staging_gov_auth) - expected: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf, actual: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: 69b18814ccfcc81f3cf3eeeac56d6daab0fe5447ce4075d6b870d581e4b63f02
Logic hash - expected: acec033e3a3089d48842ca8653750acb3f69eba26d59d4d51dec45be, actual: acec033e3a3089d48842ca8653750acb3f69eba26d59d4d51dec45be PASS
Auth hash (staging_gov_auth) - expected: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf, actual: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: a0d97a34a67cb505a7926926c33927578a5e2ba1946e5a9e7c1f9e91084f096c
Logic hash - expected: 078834e32fd4107b050411b29986fbfbafd2a8c782ab005e269ed132, actual: 078834e32fd4107b050411b29986fbfbafd2a8c782ab005e269ed132 PASS
Auth hash (staging_gov_auth) - expected: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf, actual: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 39a96e1e36ec41e8dfcc368e76abc52c0156758beb95b0f2538eb9594bb07771
Logic hash - expected: a7da620e68d07f8f49cd843d4b22f9b62e7ac4558cd156370084bffb, actual: a7da620e68d07f8f49cd843d4b22f9b62e7ac4558cd156370084bffb PASS
Auth hash (staging_gov_auth) - expected: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf, actual: a909479cfa8f094f4a62ac4126b8a7767909b17c6503c1086f22c3cf PASS
```

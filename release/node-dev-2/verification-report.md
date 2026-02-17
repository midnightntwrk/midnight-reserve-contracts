# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-17T15:59:10.917Z
**Result:** 24 CHECK(S) FAILED
**Summary:** 7 passed, 24 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash b82e95483c8318d54946d3cf2fe4384fb4720668c60ba259967bc005
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash eaf111c7d37a563ab7600a74bf2fa2d1467928ac3bd5faa93925a52a
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 5b1de8dc6526e4f3af527c44da33880377b9556d55e693bb2e4af92f
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 17cf10208692f736d27185684f764df629da56f7c73f9f19ace7df94
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash d6fb974c0e3ebc6216665653f12ac09035396af2bfa7cf16bf16f3ff
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash f64a803b1865dfb2ce0f636bff08ecebf5b7926270e86cafa378bdeb
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [FAIL] On-chain: technical-authority-deployment

```
Tx: f72ff0b45fb6a2fa87cae2434b2a46a47a031200f6170ec291cf626f4df624f7
Expected policy IDs (from NFTs): [b82e95483c8318d54946d3cf2fe4384fb4720668c60ba259967bc005, ffddbc9c1b9ac4c563f5a702857172ace2cd2b0b5160ab5135e2e8b2]
Actual on-chain policy IDs:      [5694acaf1ac42ab41f0c3d11b4a52efe10494eae0ba89eb0f679b0d7, b6a62e8711638f7072a7b0969f497e9ccc8a8802303f947be3b25482]
FAIL: Mismatch

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=709126c72aa87c1c828b039d2ee2f8e09fce4fedbb901500e673195d]
```

### [FAIL] On-chain: tech-auth-update-threshold-deployment

```
Tx: 12dd7a99a2f31f737acc391ed46fce32b9756247d3e6a1220b7eff4728a033dc
Expected policy IDs (from NFTs): [99e6068438590863aafabdc909fad22db3929173975d3c791783a76f]
Actual on-chain policy IDs:      [e990141b956c3f9e0403e6e207e5e28f4ec7531035895a1febd21094]
FAIL: Mismatch
```

### [FAIL] On-chain: council-deployment

```
Tx: 0ad0bb12b5bacf06664975b88a4c7559de883e3b821485fc83250d8406f3161b
Expected policy IDs (from NFTs): [2cb51f598f25fddce9147e0b4214072229c98af22752a34dedea98d9, eaf111c7d37a563ab7600a74bf2fa2d1467928ac3bd5faa93925a52a]
Actual on-chain policy IDs:      [655bfd1a6fba934b333e4eaf163d3b36d6eb79ce36e496e41e6edecf, 9067631a909783bdc1a1d40492cd2c3c86513f6167bd51480f02c777]
FAIL: Mismatch

Logic script(s) verified via UpgradeState datum: [council_logic=3dbe7dd0d61a0e1bf400456b3292c5079b714de9c10a6aba1629d045]
```

### [FAIL] On-chain: council-update-threshold-deployment

```
Tx: 5bfdb47d0e521ade3183e491ef4df2c8f3b1e5c7dea483011e01e5c0d6123a13
Expected policy IDs (from NFTs): [d3b4af2fdbbc9f1afe7ce7a66b342d02d6ca142400e7a4335cd0de73]
Actual on-chain policy IDs:      [597a4a8a63a43052b8322de23b632e6798973698bf71b7bae078a088]
FAIL: Mismatch
```

### [FAIL] On-chain: reserve-deployment

```
Tx: a9dcb64d53d2bd8bc4f29a6931951fc567ba7f1c725c5834e2a1e35db97021f8
Expected policy IDs (from NFTs): [5b1de8dc6526e4f3af527c44da33880377b9556d55e693bb2e4af92f, b5afdf98e378d7e8ecaaa8dfdfc84edf82f7bed10bfd7b291b7ad495]
Actual on-chain policy IDs:      [a467e96d92041f20e4bca37f3bab3d0440a415e729e58f28ef019f45, b54259ece948a7f8b6fe963dbaf48844f4cf9871f480e682568a2b1c]
FAIL: Mismatch

Logic script(s) verified via UpgradeState datum: [reserve_logic=eca3351170f0478b566e25f09b9d66e7620a4f0461132f2e84d1c9a8]
```

### [FAIL] On-chain: ics-deployment

```
Tx: 40f32edba05d07b6f034cd58db577079f64a7ddd0373892b6cdf924553aa8e57
Expected policy IDs (from NFTs): [17cf10208692f736d27185684f764df629da56f7c73f9f19ace7df94, 882e3b93294648babcf55b38b97d0422a14083f8f0e13b6353cc8938]
Actual on-chain policy IDs:      [2af0eff9c843e4aafd8d13eae4c5bd41668a525e53e4d823ca0389ae, c0619c6c89d4251a3bd8122656fa6b23ad52c1bf283bb1c20a5aef6a]
FAIL: Mismatch

Logic script(s) verified via UpgradeState datum: [ics_logic=a9c9cd76de87a7e56fb2c544c1aa6eabd5ff4762af67756ce0769e25]
```

### [FAIL] On-chain: main-gov-threshold-deployment

```
Tx: 50ee0968e7a181eda46e7f555e1b8c22c86b8358dbe8286da6f80425c8d0acb6
Expected policy IDs (from NFTs): [7a4d5e9aba2187083d7e811bf184250c0d54b1afc1d2fbc51889ed1f]
Actual on-chain policy IDs:      [34260fb035ffc9900c65863e0f518cbfcc21d781747162506a029a7c]
FAIL: Mismatch
```

### [FAIL] On-chain: staging-gov-threshold-deployment

```
Tx: 2b668a72dde4bcb8b4329e631a92f2abc9b42cf11cef3addd19de31e7057ace8
Expected policy IDs (from NFTs): [d972b085550c00fe30ed94b880816adc3fc7b42acf4e18e821738678]
Actual on-chain policy IDs:      [251479e5aca787a5a63c5c54c5229c9161eaaf5a9d9d134970640efd]
FAIL: Mismatch
```

### [FAIL] On-chain: federated-ops-deployment

```
Tx: 8a91a18f57fa644563c1ecc4a287f4ec9ac08cdb6134e694ca6b68f745a516f3
Expected policy IDs (from NFTs): [57d939e66bc70e8c2ae00b5766e3a1851bdf2bed169294d245bbb6d4, d6fb974c0e3ebc6216665653f12ac09035396af2bfa7cf16bf16f3ff]
Actual on-chain policy IDs:      [3ff4ba016144fc5dac3f60c9ddb7417c4fc9585b574c2525b23f4ef9, 8861e4f0bc89cbf34fd7cd5964f8d97afdb2b339c0cd1c3d17930581]
FAIL: Mismatch

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=a06ca50b3be0dbaee9c88604710d1950aa0c9ebf28294499532da0f0]
```

### [FAIL] On-chain: federated-ops-update-threshold-deployment

```
Tx: b17a36d88bf3e28cf108617e87810b184440ceef4459fb8943930196652261c2
Expected policy IDs (from NFTs): [30d598e2ee1c3c34d0db2cef7fd3cb8aa6a2be406fcb3726db7e15f0]
Actual on-chain policy IDs:      [3c953f1786a02167b90423885b12389c3fff29eab90532b91d29f71c]
FAIL: Mismatch
```

### [FAIL] On-chain: terms-and-conditions-deployment

```
Tx: c88689dca6a3c2d5f0203dac36ffda3613fcfae3fc870df3bba8ea49c61cc5c6
Expected policy IDs (from NFTs): [95b466b1e720d031ae5f11dca58937c6a873af4f0da7a8cfb96cdd8f, f64a803b1865dfb2ce0f636bff08ecebf5b7926270e86cafa378bdeb]
Actual on-chain policy IDs:      [42d74fa697f10f46ad5efead10f122cf1bcc03f97fdce4c2f445610c, a7e832df6f8d5b58b0d14205e50457544eb7aaa0ff2af2094ae7f0aa]
FAIL: Mismatch

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=f13f8e00eeb9a060ef122f7bc881d153bae7ffc637b2315d84edacc1]
```

### [FAIL] On-chain: terms-and-conditions-threshold-deployment

```
Tx: cb54f5b5f6c7a3cf7e2c7b65ea87c6709aa76596a8f4c5fcedb1baed1658c227
Expected policy IDs (from NFTs): [07e8419224aa6a692de5b0ab89b4cc49ef33259beeacf5ddadfd79c5]
Actual on-chain policy IDs:      [19f16b378b9ce43bae8d14c797be0dda20f0afb3df42f0177add71fc]
FAIL: Mismatch
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [FAIL] UpgradeState (main): technical-authority-deployment

```
No output found with main NFT (b82e95483c8318d54946d3cf2fe4384fb4720668c60ba259967bc0056d61696e) in tx f72ff0b45fb6a2fa87cae2434b2a46a47a031200f6170ec291cf626f4df624f7
```

### [FAIL] UpgradeState (main): council-deployment

```
No output found with main NFT (eaf111c7d37a563ab7600a74bf2fa2d1467928ac3bd5faa93925a52a6d61696e) in tx 0ad0bb12b5bacf06664975b88a4c7559de883e3b821485fc83250d8406f3161b
```

### [FAIL] UpgradeState (main): reserve-deployment

```
No output found with main NFT (5b1de8dc6526e4f3af527c44da33880377b9556d55e693bb2e4af92f6d61696e) in tx a9dcb64d53d2bd8bc4f29a6931951fc567ba7f1c725c5834e2a1e35db97021f8
```

### [FAIL] UpgradeState (main): ics-deployment

```
No output found with main NFT (17cf10208692f736d27185684f764df629da56f7c73f9f19ace7df946d61696e) in tx 40f32edba05d07b6f034cd58db577079f64a7ddd0373892b6cdf924553aa8e57
```

### [FAIL] UpgradeState (main): federated-ops-deployment

```
No output found with main NFT (d6fb974c0e3ebc6216665653f12ac09035396af2bfa7cf16bf16f3ff6d61696e) in tx 8a91a18f57fa644563c1ecc4a287f4ec9ac08cdb6134e694ca6b68f745a516f3
```

### [FAIL] UpgradeState (main): terms-and-conditions-deployment

```
No output found with main NFT (f64a803b1865dfb2ce0f636bff08ecebf5b7926270e86cafa378bdeb6d61696e) in tx c88689dca6a3c2d5f0203dac36ffda3613fcfae3fc870df3bba8ea49c61cc5c6
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [FAIL] UpgradeState (staging): technical-authority-deployment

```
No output found with staging NFT (b82e95483c8318d54946d3cf2fe4384fb4720668c60ba259967bc00573746167696e67) in tx f72ff0b45fb6a2fa87cae2434b2a46a47a031200f6170ec291cf626f4df624f7
```

### [FAIL] UpgradeState (staging): council-deployment

```
No output found with staging NFT (eaf111c7d37a563ab7600a74bf2fa2d1467928ac3bd5faa93925a52a73746167696e67) in tx 0ad0bb12b5bacf06664975b88a4c7559de883e3b821485fc83250d8406f3161b
```

### [FAIL] UpgradeState (staging): reserve-deployment

```
No output found with staging NFT (5b1de8dc6526e4f3af527c44da33880377b9556d55e693bb2e4af92f73746167696e67) in tx a9dcb64d53d2bd8bc4f29a6931951fc567ba7f1c725c5834e2a1e35db97021f8
```

### [FAIL] UpgradeState (staging): ics-deployment

```
No output found with staging NFT (17cf10208692f736d27185684f764df629da56f7c73f9f19ace7df9473746167696e67) in tx 40f32edba05d07b6f034cd58db577079f64a7ddd0373892b6cdf924553aa8e57
```

### [FAIL] UpgradeState (staging): federated-ops-deployment

```
No output found with staging NFT (d6fb974c0e3ebc6216665653f12ac09035396af2bfa7cf16bf16f3ff73746167696e67) in tx 8a91a18f57fa644563c1ecc4a287f4ec9ac08cdb6134e694ca6b68f745a516f3
```

### [FAIL] UpgradeState (staging): terms-and-conditions-deployment

```
No output found with staging NFT (f64a803b1865dfb2ce0f636bff08ecebf5b7926270e86cafa378bdeb73746167696e67) in tx c88689dca6a3c2d5f0203dac36ffda3613fcfae3fc870df3bba8ea49c61cc5c6
```

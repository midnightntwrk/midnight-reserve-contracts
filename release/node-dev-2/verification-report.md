# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-18T03:21:54.861Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash ddcca4be6713e6a1ae2c24178720b1fdc0424a959082c56f6f1edf9d
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 33e9972bf8a634336b9d8455d82f83f24b3aca1acd7b9328942b4851
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 7b5b1967cef5d57f32dd2a630a4acc78e590652a59b9cf9384a7af21
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash ec535e30cadc9a5def6336322203d6d3ac51a08cd67941bf5ce71b3f
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash f703953b2d10907f73520d8bc452787a68f4b37c593a33f2f86a53b4
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 2cb788155ecfb34a16fa4d2dafe501da1dd06b2908cb135a26dba254
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: e912cd8dff26f96ab78df2154dbc4ba277955d0efb04335735254a53085fb963
Expected policy IDs (from NFTs): [0a4ab895eef170178805c595d19c15b60e33b497604dd1a8afa605e3, ddcca4be6713e6a1ae2c24178720b1fdc0424a959082c56f6f1edf9d]
Actual on-chain policy IDs:      [0a4ab895eef170178805c595d19c15b60e33b497604dd1a8afa605e3, ddcca4be6713e6a1ae2c24178720b1fdc0424a959082c56f6f1edf9d]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=53ad21941fb6ea12bd09b1b3e80756b4008ac612688a260021b08004]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 4b817fb55570b661dd05bf8891e85858a5da0b251150e46508d808f146f83154
Expected policy IDs (from NFTs): [21157fcce235ac24595028cbabcf5ea3c07697717e0cfb0a0f8f9e57]
Actual on-chain policy IDs:      [21157fcce235ac24595028cbabcf5ea3c07697717e0cfb0a0f8f9e57]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: 6c5873b0e5b9ae817e54ef9d5e358e2bbc4bfdc9d4fee8954aff65bf92d0640e
Expected policy IDs (from NFTs): [33e9972bf8a634336b9d8455d82f83f24b3aca1acd7b9328942b4851, 56b430a7cbc98b5153bc5ef71eb31abc5492898ab80539ea91c72db6]
Actual on-chain policy IDs:      [33e9972bf8a634336b9d8455d82f83f24b3aca1acd7b9328942b4851, 56b430a7cbc98b5153bc5ef71eb31abc5492898ab80539ea91c72db6]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=51743b35074cf6d9b44b7896ec7308927952e53e5cd8f6154ae8d4c8]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: 75b22281f3b98891a28e03aa5ddd8ee6550934e297ee5355fca5f947a09240bc
Expected policy IDs (from NFTs): [2c171afec56426949db7d5e92d6f4b0e1ae1928ca62856b53af52a0f]
Actual on-chain policy IDs:      [2c171afec56426949db7d5e92d6f4b0e1ae1928ca62856b53af52a0f]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 2aece2d4c579357a75c102e3f1e6db80279029b90dd63a6f2f6a1f7bc43e4a45
Expected policy IDs (from NFTs): [7b5b1967cef5d57f32dd2a630a4acc78e590652a59b9cf9384a7af21, c730e2fd0b9b82cfd97cc2a39d2a477242d5ca898d0dcbf71f752fe3]
Actual on-chain policy IDs:      [7b5b1967cef5d57f32dd2a630a4acc78e590652a59b9cf9384a7af21, c730e2fd0b9b82cfd97cc2a39d2a477242d5ca898d0dcbf71f752fe3]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=4f6610499212b57dd4fee326155660d182c458b001fa0cbce709436a]
```

### [PASS] On-chain: ics-deployment

```
Tx: b1fe1c0970e5904d91a97e7ac195905f3371bc9a4dd72e639359c085d0985056
Expected policy IDs (from NFTs): [11b70e3850dab311e807653fa1f4b000659dbaed75252ad3460f2eee, ec535e30cadc9a5def6336322203d6d3ac51a08cd67941bf5ce71b3f]
Actual on-chain policy IDs:      [11b70e3850dab311e807653fa1f4b000659dbaed75252ad3460f2eee, ec535e30cadc9a5def6336322203d6d3ac51a08cd67941bf5ce71b3f]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=76ac1b93d73e852ba9447e30a42e7600738f75fd819c6309080489ac]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 72886074c3ed9bbefc5acb6e1b2f89b8db2277fcbd86c1708978c3c51f77867b
Expected policy IDs (from NFTs): [706048287774f28a185b978c0ed31540da9114f0e2e0f778f9d736ab]
Actual on-chain policy IDs:      [706048287774f28a185b978c0ed31540da9114f0e2e0f778f9d736ab]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: f89d03704041ed6be2d8f9e1562b651b8ad2e1f76e14025c14eca6dda270e561
Expected policy IDs (from NFTs): [a1b80d1030be5f9d04fd8f34884f9661398f46fe3ec0ad2d3ed282f6]
Actual on-chain policy IDs:      [a1b80d1030be5f9d04fd8f34884f9661398f46fe3ec0ad2d3ed282f6]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 24bf1313727cbfcd09083b8b859f4b1d9ebe7bc67d6fd3d626cd8661e76e8256
Expected policy IDs (from NFTs): [9735f5c5f68812345c6b1dc8f1286f4e0b47081925cfb1fe6d436fb0, f703953b2d10907f73520d8bc452787a68f4b37c593a33f2f86a53b4]
Actual on-chain policy IDs:      [9735f5c5f68812345c6b1dc8f1286f4e0b47081925cfb1fe6d436fb0, f703953b2d10907f73520d8bc452787a68f4b37c593a33f2f86a53b4]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=0554d217c508d158f58019c1254270dafe2f58b4cfbf80546377da45]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: db5c84696002765312abfaf3821d67c2d1faf31ca62b173e41db1dae199c18e4
Expected policy IDs (from NFTs): [66d1b8b049451f60aae6bc2ee7283c0b6e0387c00476d0fd264545d8]
Actual on-chain policy IDs:      [66d1b8b049451f60aae6bc2ee7283c0b6e0387c00476d0fd264545d8]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 38cd63e2636e2d7d7f2417ead4e7c2910884f985f7216dd5454c814e87fd70a9
Expected policy IDs (from NFTs): [2cb788155ecfb34a16fa4d2dafe501da1dd06b2908cb135a26dba254, 6b17a69e7e760f3cefef359d8d4c6732eafb37e4439d0a79d92c14b2]
Actual on-chain policy IDs:      [2cb788155ecfb34a16fa4d2dafe501da1dd06b2908cb135a26dba254, 6b17a69e7e760f3cefef359d8d4c6732eafb37e4439d0a79d92c14b2]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=3d51fec396e39b7ce7744e467daa214e78d48c5511b9ec362bbabb64]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: 1f84a4d3f82de495a45e08e460721d630d02624907710fe2600beabd1d5dceda
Expected policy IDs (from NFTs): [eb031a464bcbf03d0e59fb95dabdc504b9dd51ece4651efd7646d76a]
Actual on-chain policy IDs:      [eb031a464bcbf03d0e59fb95dabdc504b9dd51ece4651efd7646d76a]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: e912cd8dff26f96ab78df2154dbc4ba277955d0efb04335735254a53085fb963
Logic hash - expected: 53ad21941fb6ea12bd09b1b3e80756b4008ac612688a260021b08004, actual: 53ad21941fb6ea12bd09b1b3e80756b4008ac612688a260021b08004 PASS
Auth hash (main_gov_auth) - expected: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3, actual: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3 PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: 6c5873b0e5b9ae817e54ef9d5e358e2bbc4bfdc9d4fee8954aff65bf92d0640e
Logic hash - expected: 51743b35074cf6d9b44b7896ec7308927952e53e5cd8f6154ae8d4c8, actual: 51743b35074cf6d9b44b7896ec7308927952e53e5cd8f6154ae8d4c8 PASS
Auth hash (main_gov_auth) - expected: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3, actual: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3 PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 2aece2d4c579357a75c102e3f1e6db80279029b90dd63a6f2f6a1f7bc43e4a45
Logic hash - expected: 4f6610499212b57dd4fee326155660d182c458b001fa0cbce709436a, actual: 4f6610499212b57dd4fee326155660d182c458b001fa0cbce709436a PASS
Auth hash (main_gov_auth) - expected: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3, actual: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3 PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: b1fe1c0970e5904d91a97e7ac195905f3371bc9a4dd72e639359c085d0985056
Logic hash - expected: 76ac1b93d73e852ba9447e30a42e7600738f75fd819c6309080489ac, actual: 76ac1b93d73e852ba9447e30a42e7600738f75fd819c6309080489ac PASS
Auth hash (main_gov_auth) - expected: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3, actual: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3 PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 24bf1313727cbfcd09083b8b859f4b1d9ebe7bc67d6fd3d626cd8661e76e8256
Logic hash - expected: 0554d217c508d158f58019c1254270dafe2f58b4cfbf80546377da45, actual: 0554d217c508d158f58019c1254270dafe2f58b4cfbf80546377da45 PASS
Auth hash (main_gov_auth) - expected: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3, actual: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3 PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 38cd63e2636e2d7d7f2417ead4e7c2910884f985f7216dd5454c814e87fd70a9
Logic hash - expected: 3d51fec396e39b7ce7744e467daa214e78d48c5511b9ec362bbabb64, actual: 3d51fec396e39b7ce7744e467daa214e78d48c5511b9ec362bbabb64 PASS
Auth hash (main_gov_auth) - expected: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3, actual: df7fbc3b0c139277c9f2adfcc539c789863d97386f960d6d31e503e3 PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: e912cd8dff26f96ab78df2154dbc4ba277955d0efb04335735254a53085fb963
Logic hash - expected: 53ad21941fb6ea12bd09b1b3e80756b4008ac612688a260021b08004, actual: 53ad21941fb6ea12bd09b1b3e80756b4008ac612688a260021b08004 PASS
Auth hash (staging_gov_auth) - expected: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f, actual: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: 6c5873b0e5b9ae817e54ef9d5e358e2bbc4bfdc9d4fee8954aff65bf92d0640e
Logic hash - expected: 51743b35074cf6d9b44b7896ec7308927952e53e5cd8f6154ae8d4c8, actual: 51743b35074cf6d9b44b7896ec7308927952e53e5cd8f6154ae8d4c8 PASS
Auth hash (staging_gov_auth) - expected: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f, actual: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 2aece2d4c579357a75c102e3f1e6db80279029b90dd63a6f2f6a1f7bc43e4a45
Logic hash - expected: 4f6610499212b57dd4fee326155660d182c458b001fa0cbce709436a, actual: 4f6610499212b57dd4fee326155660d182c458b001fa0cbce709436a PASS
Auth hash (staging_gov_auth) - expected: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f, actual: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: b1fe1c0970e5904d91a97e7ac195905f3371bc9a4dd72e639359c085d0985056
Logic hash - expected: 76ac1b93d73e852ba9447e30a42e7600738f75fd819c6309080489ac, actual: 76ac1b93d73e852ba9447e30a42e7600738f75fd819c6309080489ac PASS
Auth hash (staging_gov_auth) - expected: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f, actual: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 24bf1313727cbfcd09083b8b859f4b1d9ebe7bc67d6fd3d626cd8661e76e8256
Logic hash - expected: 0554d217c508d158f58019c1254270dafe2f58b4cfbf80546377da45, actual: 0554d217c508d158f58019c1254270dafe2f58b4cfbf80546377da45 PASS
Auth hash (staging_gov_auth) - expected: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f, actual: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 38cd63e2636e2d7d7f2417ead4e7c2910884f985f7216dd5454c814e87fd70a9
Logic hash - expected: 3d51fec396e39b7ce7744e467daa214e78d48c5511b9ec362bbabb64, actual: 3d51fec396e39b7ce7744e467daa214e78d48c5511b9ec362bbabb64 PASS
Auth hash (staging_gov_auth) - expected: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f, actual: 8ff7b53524c7a1cf13d5bb73ebcac2c043977dd3f29a66be81fdac5f PASS
```

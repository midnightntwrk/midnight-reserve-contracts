# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-20T02:55:21.626Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash 098ee7319e06d083e17d7925bb301c513ddafac5b0ededa07ffd8eb6
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 95b5a52ab17e97ce4ffcb7ab5cf09e56bf80b323debb20511a5e38e0
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 4d019df59554bebddc3b8964e069619049564db08745324dc02c7d80
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 1b8df65f70da074815c30ae3a86af0a1563fa76f2eabeb69aa51d931
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash 6a43f38d0ed182562754c2c8ab3500022a78d52e9cbae4e01107ee4b
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 02a34ed69cba07cc8c2bcf27fa98751b13bc099f81c53ff164cb4cc8
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: 8d3dc230a4eeaedc99b355075ad269f8d4ff10f071950380bd9df55218aedf10
Expected policy IDs (from NFTs): [098ee7319e06d083e17d7925bb301c513ddafac5b0ededa07ffd8eb6, f7011744ee3c23e29e859f0780b97d7200707147dd0d79a665096366]
Actual on-chain policy IDs:      [098ee7319e06d083e17d7925bb301c513ddafac5b0ededa07ffd8eb6, f7011744ee3c23e29e859f0780b97d7200707147dd0d79a665096366]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=3cdfa71f0717ebdda5af42122ed904830d0f7d69074f9f81fd1cc1eb]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 431856ae031bf9b9a7c66d6da86d77e283c6df7d8c923f2c6358cd9c59cebf51
Expected policy IDs (from NFTs): [611fb4c3ca542b733c79895beb627cc3dbf9ec9e7a15705312d196ac]
Actual on-chain policy IDs:      [611fb4c3ca542b733c79895beb627cc3dbf9ec9e7a15705312d196ac]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: b510502846601a21f068c562cd7a8b488d5c9c3f325b8136c4ecbaf06acbc62e
Expected policy IDs (from NFTs): [95b5a52ab17e97ce4ffcb7ab5cf09e56bf80b323debb20511a5e38e0, a0360c7ffa4b70e6496be713b01505c5cff1aae577a0dfb93a121727]
Actual on-chain policy IDs:      [95b5a52ab17e97ce4ffcb7ab5cf09e56bf80b323debb20511a5e38e0, a0360c7ffa4b70e6496be713b01505c5cff1aae577a0dfb93a121727]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=880a920778433c9cc721fc5c699d4f59573fd9009d7b47d007734fd1]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: 366f3de7c7d73095ea5f59092562283bd0d2a49dbc05087c4890b45763b34c9e
Expected policy IDs (from NFTs): [51c3db5ee6366ddf6d6b2798a590def514ac63711af150a544488ba5]
Actual on-chain policy IDs:      [51c3db5ee6366ddf6d6b2798a590def514ac63711af150a544488ba5]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 32f013d1f880f2f0fb95e683f719d629aaf65489af742732ad29c2193f79fde7
Expected policy IDs (from NFTs): [4d019df59554bebddc3b8964e069619049564db08745324dc02c7d80, 751b91e16e56f74ccd2c4ced7aa0f2654ee4d6b48dff7db26764a6d2]
Actual on-chain policy IDs:      [4d019df59554bebddc3b8964e069619049564db08745324dc02c7d80, 751b91e16e56f74ccd2c4ced7aa0f2654ee4d6b48dff7db26764a6d2]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=a129e81e3558f39c6cf9e2f56834f455a8ecfd0dcf9f4b12b63e70c5]
```

### [PASS] On-chain: ics-deployment

```
Tx: b7868650ae9510b385deb919f16e6ea5ac07b200c0c41a7199ad5d6707bca92a
Expected policy IDs (from NFTs): [1b8df65f70da074815c30ae3a86af0a1563fa76f2eabeb69aa51d931, a337e735bd2c5d3e1b3c20a6bd08d823c241edac9019247d74ee2ef0]
Actual on-chain policy IDs:      [1b8df65f70da074815c30ae3a86af0a1563fa76f2eabeb69aa51d931, a337e735bd2c5d3e1b3c20a6bd08d823c241edac9019247d74ee2ef0]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=4728b5116edd063511803f194da5c1de5117d9cdae443f44e1009cdd]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 79358292c01ed9363a431e2cbbdd0125b2147680973d87690ec926ef77150bd0
Expected policy IDs (from NFTs): [d2afeb40216ea5210d4dce360dad1577646253256652f1c3a9610c0d]
Actual on-chain policy IDs:      [d2afeb40216ea5210d4dce360dad1577646253256652f1c3a9610c0d]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 89be9b3a57aea8bbe931d2e56605f692bec928859bb588517a81418a27346136
Expected policy IDs (from NFTs): [d8de7adc51fa6348408471757dbbe00606795c7d17dd10f87060ece7]
Actual on-chain policy IDs:      [d8de7adc51fa6348408471757dbbe00606795c7d17dd10f87060ece7]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 3fd9b7c7480ceb7646e6149eece8c851faf685e846f978b63fa8b006f7e3177d
Expected policy IDs (from NFTs): [6a43f38d0ed182562754c2c8ab3500022a78d52e9cbae4e01107ee4b, d5b7d103c333736d1515461c68fcc693493f3efcf3ec85155d36bb20]
Actual on-chain policy IDs:      [6a43f38d0ed182562754c2c8ab3500022a78d52e9cbae4e01107ee4b, d5b7d103c333736d1515461c68fcc693493f3efcf3ec85155d36bb20]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=ac76b624b9da7a8045a3515b1e1a840f5d300845db3739ce40bf6b4f]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 108ed797fb5c558fea808c955342a765b52a2e36c518b54d9c9b3546ff01bafd
Expected policy IDs (from NFTs): [1ea4f159ce621cc24bd3a9bccd86b63a8ccd3667f4638e44fced9805]
Actual on-chain policy IDs:      [1ea4f159ce621cc24bd3a9bccd86b63a8ccd3667f4638e44fced9805]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 1481fc9f100aac6ea57a06573e72ae38dcfefe6847f00351b3261aa6f0cf1649
Expected policy IDs (from NFTs): [02a34ed69cba07cc8c2bcf27fa98751b13bc099f81c53ff164cb4cc8, 8e07da212f0f40d40a212b49425356ec4bc05d6befc58dda6444acb1]
Actual on-chain policy IDs:      [02a34ed69cba07cc8c2bcf27fa98751b13bc099f81c53ff164cb4cc8, 8e07da212f0f40d40a212b49425356ec4bc05d6befc58dda6444acb1]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=82310f9ec20310dd484cdf6cabba4a5e7e48f1644368db2dedc3f021]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: da1b6bef66323aa560ae6b1a03e46c8c8e24ae1bb131f8a0fef8c0b5a57c502e
Expected policy IDs (from NFTs): [2feefbc677fea3ea3d43b90cd3ed4283fd4d5742d5efc436849acc58]
Actual on-chain policy IDs:      [2feefbc677fea3ea3d43b90cd3ed4283fd4d5742d5efc436849acc58]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: 8d3dc230a4eeaedc99b355075ad269f8d4ff10f071950380bd9df55218aedf10
Logic hash - expected: 3cdfa71f0717ebdda5af42122ed904830d0f7d69074f9f81fd1cc1eb, actual: 3cdfa71f0717ebdda5af42122ed904830d0f7d69074f9f81fd1cc1eb PASS
Auth hash (main_gov_auth) - expected: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671, actual: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671 PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: b510502846601a21f068c562cd7a8b488d5c9c3f325b8136c4ecbaf06acbc62e
Logic hash - expected: 880a920778433c9cc721fc5c699d4f59573fd9009d7b47d007734fd1, actual: 880a920778433c9cc721fc5c699d4f59573fd9009d7b47d007734fd1 PASS
Auth hash (main_gov_auth) - expected: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671, actual: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671 PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 32f013d1f880f2f0fb95e683f719d629aaf65489af742732ad29c2193f79fde7
Logic hash - expected: a129e81e3558f39c6cf9e2f56834f455a8ecfd0dcf9f4b12b63e70c5, actual: a129e81e3558f39c6cf9e2f56834f455a8ecfd0dcf9f4b12b63e70c5 PASS
Auth hash (main_gov_auth) - expected: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671, actual: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671 PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: b7868650ae9510b385deb919f16e6ea5ac07b200c0c41a7199ad5d6707bca92a
Logic hash - expected: 4728b5116edd063511803f194da5c1de5117d9cdae443f44e1009cdd, actual: 4728b5116edd063511803f194da5c1de5117d9cdae443f44e1009cdd PASS
Auth hash (main_gov_auth) - expected: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671, actual: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671 PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 3fd9b7c7480ceb7646e6149eece8c851faf685e846f978b63fa8b006f7e3177d
Logic hash - expected: ac76b624b9da7a8045a3515b1e1a840f5d300845db3739ce40bf6b4f, actual: ac76b624b9da7a8045a3515b1e1a840f5d300845db3739ce40bf6b4f PASS
Auth hash (main_gov_auth) - expected: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671, actual: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671 PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 1481fc9f100aac6ea57a06573e72ae38dcfefe6847f00351b3261aa6f0cf1649
Logic hash - expected: 82310f9ec20310dd484cdf6cabba4a5e7e48f1644368db2dedc3f021, actual: 82310f9ec20310dd484cdf6cabba4a5e7e48f1644368db2dedc3f021 PASS
Auth hash (main_gov_auth) - expected: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671, actual: e90850f71da53cd49cb3b3ffdd52ca75c8b90016cdd58ef4c2b4b671 PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: 8d3dc230a4eeaedc99b355075ad269f8d4ff10f071950380bd9df55218aedf10
Logic hash - expected: 3cdfa71f0717ebdda5af42122ed904830d0f7d69074f9f81fd1cc1eb, actual: 3cdfa71f0717ebdda5af42122ed904830d0f7d69074f9f81fd1cc1eb PASS
Auth hash (staging_gov_auth) - expected: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913, actual: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913 PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: b510502846601a21f068c562cd7a8b488d5c9c3f325b8136c4ecbaf06acbc62e
Logic hash - expected: 880a920778433c9cc721fc5c699d4f59573fd9009d7b47d007734fd1, actual: 880a920778433c9cc721fc5c699d4f59573fd9009d7b47d007734fd1 PASS
Auth hash (staging_gov_auth) - expected: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913, actual: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913 PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 32f013d1f880f2f0fb95e683f719d629aaf65489af742732ad29c2193f79fde7
Logic hash - expected: a129e81e3558f39c6cf9e2f56834f455a8ecfd0dcf9f4b12b63e70c5, actual: a129e81e3558f39c6cf9e2f56834f455a8ecfd0dcf9f4b12b63e70c5 PASS
Auth hash (staging_gov_auth) - expected: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913, actual: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913 PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: b7868650ae9510b385deb919f16e6ea5ac07b200c0c41a7199ad5d6707bca92a
Logic hash - expected: 4728b5116edd063511803f194da5c1de5117d9cdae443f44e1009cdd, actual: 4728b5116edd063511803f194da5c1de5117d9cdae443f44e1009cdd PASS
Auth hash (staging_gov_auth) - expected: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913, actual: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913 PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 3fd9b7c7480ceb7646e6149eece8c851faf685e846f978b63fa8b006f7e3177d
Logic hash - expected: ac76b624b9da7a8045a3515b1e1a840f5d300845db3739ce40bf6b4f, actual: ac76b624b9da7a8045a3515b1e1a840f5d300845db3739ce40bf6b4f PASS
Auth hash (staging_gov_auth) - expected: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913, actual: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913 PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 1481fc9f100aac6ea57a06573e72ae38dcfefe6847f00351b3261aa6f0cf1649
Logic hash - expected: 82310f9ec20310dd484cdf6cabba4a5e7e48f1644368db2dedc3f021, actual: 82310f9ec20310dd484cdf6cabba4a5e7e48f1644368db2dedc3f021 PASS
Auth hash (staging_gov_auth) - expected: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913, actual: 002105fe1296572d6ad3a4699afaf7b18de2de62c829d82897acc913 PASS
```

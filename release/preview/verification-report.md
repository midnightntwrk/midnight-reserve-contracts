# Deployment Verification Report

**Network:** preview
**Date:** 2026-03-12T17:42:32.487Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash f63a7e9a8cf9b3fd33c28205037697a909fa7472f4c47be972845547
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 2e74df06296a880f611ee6586388a0b2b49bf798cf9d78022960ba31
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 305f6cb93fbe7093478d2d58a893db87eb6b6dbbfe42015129527803
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 83d827e59b1a0820855ba157849b8952f1ed8a65f7c16162b0ca8636
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash 81691008ed3d4e2abd4feec1b3c11e52bd506acc58b82140436e4bfd
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash c25fd4c000ff173d71964b387057d1723ec157173ab2aed419a30023
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: c8bc37ba15c96e698b59b31fdb01f631dfef256dcb32df0aeccaf600028f7fde
Expected policy IDs (from NFTs): [57827ae51eed76cef38c99bd2f97cdf0055ef714d6c9bdf3078a1b9f, f63a7e9a8cf9b3fd33c28205037697a909fa7472f4c47be972845547]
Actual on-chain policy IDs:      [57827ae51eed76cef38c99bd2f97cdf0055ef714d6c9bdf3078a1b9f, f63a7e9a8cf9b3fd33c28205037697a909fa7472f4c47be972845547]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=a01b29b7b648247aeb4891ad59a1dd481b866ff67caac70d37931cfd]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 4b15bd7964c0f7f079a040818b61515ce168eac59f9ec8b6bba99723879534ad
Expected policy IDs (from NFTs): [8cbe93dfaa3e24cffe254e54d15593885219280f3c34d2e44a446b58]
Actual on-chain policy IDs:      [8cbe93dfaa3e24cffe254e54d15593885219280f3c34d2e44a446b58]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: 7fdd3056ababd8a752e685ef5e50dde30295e69df5ff171b75958c15e68b98b6
Expected policy IDs (from NFTs): [2e74df06296a880f611ee6586388a0b2b49bf798cf9d78022960ba31, 895f09b002941417f53e28c7a4f1a7e4d90ac2afa1da0ba5c66f8ccb]
Actual on-chain policy IDs:      [2e74df06296a880f611ee6586388a0b2b49bf798cf9d78022960ba31, 895f09b002941417f53e28c7a4f1a7e4d90ac2afa1da0ba5c66f8ccb]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=fe47746010d11f30f8bda8aa96b33d70253bf0045cae6829fff83a0a]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: d0d5ed3e9164f340087d04f9a549f73d966c4e6c19e66b4ea1a100c0955d6e92
Expected policy IDs (from NFTs): [4ae0cec1a8bdaba1cde596d2f179c135ea31b759e587a40097173e9e]
Actual on-chain policy IDs:      [4ae0cec1a8bdaba1cde596d2f179c135ea31b759e587a40097173e9e]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: a539270887861da9890042aa07248786dae7df904f1b4d30e6bb217d3b8cf149
Expected policy IDs (from NFTs): [305f6cb93fbe7093478d2d58a893db87eb6b6dbbfe42015129527803, 9a16849963cf308e36590856c2ccba98575a2c0dfbb6ead6d3c1b92d]
Actual on-chain policy IDs:      [305f6cb93fbe7093478d2d58a893db87eb6b6dbbfe42015129527803, 9a16849963cf308e36590856c2ccba98575a2c0dfbb6ead6d3c1b92d]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=385c55bd0e88b22de6bbe340cb0e2b6fab2f1d34cba64d5f17853258]
```

### [PASS] On-chain: ics-deployment

```
Tx: 3724b9fd138acd7c2bf089a35e7955c0e28fc506be285ca1cc00fcd2faf2cce6
Expected policy IDs (from NFTs): [83d827e59b1a0820855ba157849b8952f1ed8a65f7c16162b0ca8636, 91d2a2ab768ab725819126463482605344bf273b3579f0b9b94086cc]
Actual on-chain policy IDs:      [83d827e59b1a0820855ba157849b8952f1ed8a65f7c16162b0ca8636, 91d2a2ab768ab725819126463482605344bf273b3579f0b9b94086cc]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=1dab820f5dd22d8ec2961a1345981144f169ea9ecb9624f8d928ff80]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 046e99c7ac08954d2cec8904ff0a8ad2c310c8faa2085dd4bdd7b2251fe7c883
Expected policy IDs (from NFTs): [6e58113aef37cf01071621236b1c59b886c5da0b4d46872861a88c1b]
Actual on-chain policy IDs:      [6e58113aef37cf01071621236b1c59b886c5da0b4d46872861a88c1b]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: d7569face5281ceedcc227d462f1af4c6f03841909fffdbd155c1b5ac1d5fb59
Expected policy IDs (from NFTs): [7df61de1971db6911c45b06c380d1be4df92c6cfdd27756cb5d30bdf]
Actual on-chain policy IDs:      [7df61de1971db6911c45b06c380d1be4df92c6cfdd27756cb5d30bdf]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 6aecb0ed06cd76c7533d731766316492850f1ec3c17663a7cc6f8acc31109cee
Expected policy IDs (from NFTs): [24dccfce2576ae6fa7149bc485850656ae6faf9f4158891316773a78, 81691008ed3d4e2abd4feec1b3c11e52bd506acc58b82140436e4bfd]
Actual on-chain policy IDs:      [24dccfce2576ae6fa7149bc485850656ae6faf9f4158891316773a78, 81691008ed3d4e2abd4feec1b3c11e52bd506acc58b82140436e4bfd]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=d505d291ae55e8bbbff2f839dc1b937936da94e5a9262393b4dea75f]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 651598dff15eee5578031a5557689895509343386a145899b8c11f3d0d15e3dc
Expected policy IDs (from NFTs): [a6afbeac04881e5e0db294ccc5f9543025feabc6e08aa7cdd4ac097b]
Actual on-chain policy IDs:      [a6afbeac04881e5e0db294ccc5f9543025feabc6e08aa7cdd4ac097b]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 39d2d371ed5e53f49fae2a5cdd50a7ef5c688e41903d8b2197d5e464199ca540
Expected policy IDs (from NFTs): [0fd566187324138d7c2c3db04e80c1da38a158c22e7af069f796439c, c25fd4c000ff173d71964b387057d1723ec157173ab2aed419a30023]
Actual on-chain policy IDs:      [0fd566187324138d7c2c3db04e80c1da38a158c22e7af069f796439c, c25fd4c000ff173d71964b387057d1723ec157173ab2aed419a30023]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=0851dd89293fbacd0ac670c79f4dde9519242421e828e19bbf0b1a0c]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: 6080346657b721faa8868849d35a4dfd13171866446e10f3bd2f047e484927af
Expected policy IDs (from NFTs): [f115c735779880fcf295868ace8ee59c11cb64994a19ca2f77f89bba]
Actual on-chain policy IDs:      [f115c735779880fcf295868ace8ee59c11cb64994a19ca2f77f89bba]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: c8bc37ba15c96e698b59b31fdb01f631dfef256dcb32df0aeccaf600028f7fde
Logic hash - expected: a01b29b7b648247aeb4891ad59a1dd481b866ff67caac70d37931cfd, actual: a01b29b7b648247aeb4891ad59a1dd481b866ff67caac70d37931cfd PASS
Auth hash (main_gov_auth) - expected: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b, actual: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: 7fdd3056ababd8a752e685ef5e50dde30295e69df5ff171b75958c15e68b98b6
Logic hash - expected: fe47746010d11f30f8bda8aa96b33d70253bf0045cae6829fff83a0a, actual: fe47746010d11f30f8bda8aa96b33d70253bf0045cae6829fff83a0a PASS
Auth hash (main_gov_auth) - expected: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b, actual: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: a539270887861da9890042aa07248786dae7df904f1b4d30e6bb217d3b8cf149
Logic hash - expected: 385c55bd0e88b22de6bbe340cb0e2b6fab2f1d34cba64d5f17853258, actual: 385c55bd0e88b22de6bbe340cb0e2b6fab2f1d34cba64d5f17853258 PASS
Auth hash (main_gov_auth) - expected: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b, actual: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: 3724b9fd138acd7c2bf089a35e7955c0e28fc506be285ca1cc00fcd2faf2cce6
Logic hash - expected: 1dab820f5dd22d8ec2961a1345981144f169ea9ecb9624f8d928ff80, actual: 1dab820f5dd22d8ec2961a1345981144f169ea9ecb9624f8d928ff80 PASS
Auth hash (main_gov_auth) - expected: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b, actual: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 6aecb0ed06cd76c7533d731766316492850f1ec3c17663a7cc6f8acc31109cee
Logic hash - expected: d505d291ae55e8bbbff2f839dc1b937936da94e5a9262393b4dea75f, actual: d505d291ae55e8bbbff2f839dc1b937936da94e5a9262393b4dea75f PASS
Auth hash (main_gov_auth) - expected: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b, actual: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 39d2d371ed5e53f49fae2a5cdd50a7ef5c688e41903d8b2197d5e464199ca540
Logic hash - expected: 0851dd89293fbacd0ac670c79f4dde9519242421e828e19bbf0b1a0c, actual: 0851dd89293fbacd0ac670c79f4dde9519242421e828e19bbf0b1a0c PASS
Auth hash (main_gov_auth) - expected: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b, actual: bd114cbcd86f12a142ea2504d570c17e6cc7782c6f5c70d70081236b PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: c8bc37ba15c96e698b59b31fdb01f631dfef256dcb32df0aeccaf600028f7fde
Logic hash - expected: a01b29b7b648247aeb4891ad59a1dd481b866ff67caac70d37931cfd, actual: a01b29b7b648247aeb4891ad59a1dd481b866ff67caac70d37931cfd PASS
Auth hash (staging_gov_auth) - expected: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6, actual: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6 PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: 7fdd3056ababd8a752e685ef5e50dde30295e69df5ff171b75958c15e68b98b6
Logic hash - expected: fe47746010d11f30f8bda8aa96b33d70253bf0045cae6829fff83a0a, actual: fe47746010d11f30f8bda8aa96b33d70253bf0045cae6829fff83a0a PASS
Auth hash (staging_gov_auth) - expected: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6, actual: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6 PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: a539270887861da9890042aa07248786dae7df904f1b4d30e6bb217d3b8cf149
Logic hash - expected: 385c55bd0e88b22de6bbe340cb0e2b6fab2f1d34cba64d5f17853258, actual: 385c55bd0e88b22de6bbe340cb0e2b6fab2f1d34cba64d5f17853258 PASS
Auth hash (staging_gov_auth) - expected: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6, actual: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6 PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: 3724b9fd138acd7c2bf089a35e7955c0e28fc506be285ca1cc00fcd2faf2cce6
Logic hash - expected: 1dab820f5dd22d8ec2961a1345981144f169ea9ecb9624f8d928ff80, actual: 1dab820f5dd22d8ec2961a1345981144f169ea9ecb9624f8d928ff80 PASS
Auth hash (staging_gov_auth) - expected: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6, actual: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6 PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 6aecb0ed06cd76c7533d731766316492850f1ec3c17663a7cc6f8acc31109cee
Logic hash - expected: d505d291ae55e8bbbff2f839dc1b937936da94e5a9262393b4dea75f, actual: d505d291ae55e8bbbff2f839dc1b937936da94e5a9262393b4dea75f PASS
Auth hash (staging_gov_auth) - expected: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6, actual: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6 PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 39d2d371ed5e53f49fae2a5cdd50a7ef5c688e41903d8b2197d5e464199ca540
Logic hash - expected: 0851dd89293fbacd0ac670c79f4dde9519242421e828e19bbf0b1a0c, actual: 0851dd89293fbacd0ac670c79f4dde9519242421e828e19bbf0b1a0c PASS
Auth hash (staging_gov_auth) - expected: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6, actual: d0f5808d3a9ce17e72a69985aa37ba87b2479ccf72c5a1186b5f9bf6 PASS
```

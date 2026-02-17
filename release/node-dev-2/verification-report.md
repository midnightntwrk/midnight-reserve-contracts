# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-17T23:01:19.354Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash e1d7c7b3b0b9f4162d0a5a5f58a38e2a4935a602e75c750c146f4312
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash babcc7f5e5266353f6561ba138f4255cea28a8ad65612ecbc01fe929
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 24cb5c1256013ce5bd0e2eb87e12cc3767ee66ecf6d9259b899f7783
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash bd388d89a316b8294bbd66182129f1b95897280514cd62cc3ddf8704
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash c7eed4b41255e99b3ff007b11e40c55b4774a89c52e2ab291a9af88a
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 96176fd04097027a45fea3ff7285a3899abaedf7dd8587fc6b28388b
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: a9295debf84a2835368f2ab6c50d878ece8d058833dd6372243be77d708f278d
Expected policy IDs (from NFTs): [de7d9cf6a98302eafd2a5fb5488e91eedc080587ae278406888c539a, e1d7c7b3b0b9f4162d0a5a5f58a38e2a4935a602e75c750c146f4312]
Actual on-chain policy IDs:      [de7d9cf6a98302eafd2a5fb5488e91eedc080587ae278406888c539a, e1d7c7b3b0b9f4162d0a5a5f58a38e2a4935a602e75c750c146f4312]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=0dfd731f295c8bf444df082ad09735c1d90d184ef967454876918dfd]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: c0615edfd3f7c53049e46c5ac0c6fd1c46c9212bfcf76f18554117b648de7ddd
Expected policy IDs (from NFTs): [b8a844e3edf133cd7223fbe27e1c133ee8c5acb3f5ffe8875a3b6f27]
Actual on-chain policy IDs:      [b8a844e3edf133cd7223fbe27e1c133ee8c5acb3f5ffe8875a3b6f27]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: 671c2bb1e5c977b8e1ca3f3e819128c5fbdc2d99a6fb0f69b3093d3cd3a15ea4
Expected policy IDs (from NFTs): [babcc7f5e5266353f6561ba138f4255cea28a8ad65612ecbc01fe929, bd2e9301a3c904e10b34418970fad5cd4a379e330c54b03ef3fe6a4a]
Actual on-chain policy IDs:      [babcc7f5e5266353f6561ba138f4255cea28a8ad65612ecbc01fe929, bd2e9301a3c904e10b34418970fad5cd4a379e330c54b03ef3fe6a4a]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=f0fff4b2c94dbd18e2827a3dc67c8408f0e2c12ddba3560195193675]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: 8e632dd95067a09b3c781b26855f8d131b12583f925275226b4325b79d9833dd
Expected policy IDs (from NFTs): [ee91ad51e6795ee28869e9b79eea00e8b8339362e7b6a8206dd060aa]
Actual on-chain policy IDs:      [ee91ad51e6795ee28869e9b79eea00e8b8339362e7b6a8206dd060aa]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 94c4e7af120667dc8aef0cec442521f6c3bc1bf59f8b86f1a81efbb56c8f23eb
Expected policy IDs (from NFTs): [24cb5c1256013ce5bd0e2eb87e12cc3767ee66ecf6d9259b899f7783, c9ef0401b439a4a8ed365b638798b59fedb3457e23cfdc6702801c15]
Actual on-chain policy IDs:      [24cb5c1256013ce5bd0e2eb87e12cc3767ee66ecf6d9259b899f7783, c9ef0401b439a4a8ed365b638798b59fedb3457e23cfdc6702801c15]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=9d8d461d8692a0c405d97cda043c2005277906deee659e6897e910fa]
```

### [PASS] On-chain: ics-deployment

```
Tx: d66ded73af35cea749dffcda6e4d39aa03e9ee63337a29ae16456d1fc89aa5fb
Expected policy IDs (from NFTs): [a4e7a9c5d90b9017654ebfe550ce296c14ad4a8fb3115c0aac25e02e, bd388d89a316b8294bbd66182129f1b95897280514cd62cc3ddf8704]
Actual on-chain policy IDs:      [a4e7a9c5d90b9017654ebfe550ce296c14ad4a8fb3115c0aac25e02e, bd388d89a316b8294bbd66182129f1b95897280514cd62cc3ddf8704]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=6649e8e8fa5a62b040669f5916e7ee29ac311a408f4128083bea33e0]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: f596d801ff1d0c5b4fcee6fce03016198a2d6f92b846880ce994e42dae9495b9
Expected policy IDs (from NFTs): [a79bfa918883daca74eeb61eb19fe774e49ee0f4ed7d070d5ba26b34]
Actual on-chain policy IDs:      [a79bfa918883daca74eeb61eb19fe774e49ee0f4ed7d070d5ba26b34]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: db78797f94f12a9f1cc5356a29cda19c7eb01bf10d849c59e471bb857f4e0479
Expected policy IDs (from NFTs): [3f5073826f5547b87f0e863da94246929d301ce1027d30c081a23562]
Actual on-chain policy IDs:      [3f5073826f5547b87f0e863da94246929d301ce1027d30c081a23562]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 071842d66f8e900b7b488af23ab6ec21cdb64f77b9e4d003cd346965554a23d9
Expected policy IDs (from NFTs): [6bf2d0a4b0003ef0a06efdb6c7877467d552aba0ca5c9abf12ef81d8, c7eed4b41255e99b3ff007b11e40c55b4774a89c52e2ab291a9af88a]
Actual on-chain policy IDs:      [6bf2d0a4b0003ef0a06efdb6c7877467d552aba0ca5c9abf12ef81d8, c7eed4b41255e99b3ff007b11e40c55b4774a89c52e2ab291a9af88a]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=943a2f856ca2dbd5ed920b8367409a9adfe80ba19b117a12d4b94718]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: eb6912ed1be3ebf7bb7131a3f492a7fef11f691e18b572fc90d3c2d79b0399cf
Expected policy IDs (from NFTs): [6b22de6816e918d9736292536a1634122b2f4c0993f1001eab0a9414]
Actual on-chain policy IDs:      [6b22de6816e918d9736292536a1634122b2f4c0993f1001eab0a9414]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 49f008697c7af999c0e443615bb502fc83fc9d03920bb5481c5e75915ef71dfe
Expected policy IDs (from NFTs): [1f57f2e7ef769e9e093dcc9cad585e7520a5dda41102934751bb195e, 96176fd04097027a45fea3ff7285a3899abaedf7dd8587fc6b28388b]
Actual on-chain policy IDs:      [1f57f2e7ef769e9e093dcc9cad585e7520a5dda41102934751bb195e, 96176fd04097027a45fea3ff7285a3899abaedf7dd8587fc6b28388b]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=4e326449c5d1b6a18f335368756d71404a246bf240074b6f2e37b926]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: c45871eabddc2e9ac91e7d4ccf58f5830de1af16651565ced85cf96f9cbe14ba
Expected policy IDs (from NFTs): [9342f7e6e7b34ffa180b7837ae50415157569ffebad01c36a9f8b889]
Actual on-chain policy IDs:      [9342f7e6e7b34ffa180b7837ae50415157569ffebad01c36a9f8b889]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: a9295debf84a2835368f2ab6c50d878ece8d058833dd6372243be77d708f278d
Logic hash - expected: 0dfd731f295c8bf444df082ad09735c1d90d184ef967454876918dfd, actual: 0dfd731f295c8bf444df082ad09735c1d90d184ef967454876918dfd PASS
Auth hash (main_gov_auth) - expected: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e, actual: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: 671c2bb1e5c977b8e1ca3f3e819128c5fbdc2d99a6fb0f69b3093d3cd3a15ea4
Logic hash - expected: f0fff4b2c94dbd18e2827a3dc67c8408f0e2c12ddba3560195193675, actual: f0fff4b2c94dbd18e2827a3dc67c8408f0e2c12ddba3560195193675 PASS
Auth hash (main_gov_auth) - expected: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e, actual: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 94c4e7af120667dc8aef0cec442521f6c3bc1bf59f8b86f1a81efbb56c8f23eb
Logic hash - expected: 9d8d461d8692a0c405d97cda043c2005277906deee659e6897e910fa, actual: 9d8d461d8692a0c405d97cda043c2005277906deee659e6897e910fa PASS
Auth hash (main_gov_auth) - expected: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e, actual: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: d66ded73af35cea749dffcda6e4d39aa03e9ee63337a29ae16456d1fc89aa5fb
Logic hash - expected: 6649e8e8fa5a62b040669f5916e7ee29ac311a408f4128083bea33e0, actual: 6649e8e8fa5a62b040669f5916e7ee29ac311a408f4128083bea33e0 PASS
Auth hash (main_gov_auth) - expected: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e, actual: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 071842d66f8e900b7b488af23ab6ec21cdb64f77b9e4d003cd346965554a23d9
Logic hash - expected: 943a2f856ca2dbd5ed920b8367409a9adfe80ba19b117a12d4b94718, actual: 943a2f856ca2dbd5ed920b8367409a9adfe80ba19b117a12d4b94718 PASS
Auth hash (main_gov_auth) - expected: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e, actual: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 49f008697c7af999c0e443615bb502fc83fc9d03920bb5481c5e75915ef71dfe
Logic hash - expected: 4e326449c5d1b6a18f335368756d71404a246bf240074b6f2e37b926, actual: 4e326449c5d1b6a18f335368756d71404a246bf240074b6f2e37b926 PASS
Auth hash (main_gov_auth) - expected: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e, actual: f911a2b468a2fb98e0016b00cfbf4315393e1a938007c45640c6768e PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: a9295debf84a2835368f2ab6c50d878ece8d058833dd6372243be77d708f278d
Logic hash - expected: 0dfd731f295c8bf444df082ad09735c1d90d184ef967454876918dfd, actual: 0dfd731f295c8bf444df082ad09735c1d90d184ef967454876918dfd PASS
Auth hash (staging_gov_auth) - expected: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2, actual: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2 PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: 671c2bb1e5c977b8e1ca3f3e819128c5fbdc2d99a6fb0f69b3093d3cd3a15ea4
Logic hash - expected: f0fff4b2c94dbd18e2827a3dc67c8408f0e2c12ddba3560195193675, actual: f0fff4b2c94dbd18e2827a3dc67c8408f0e2c12ddba3560195193675 PASS
Auth hash (staging_gov_auth) - expected: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2, actual: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2 PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 94c4e7af120667dc8aef0cec442521f6c3bc1bf59f8b86f1a81efbb56c8f23eb
Logic hash - expected: 9d8d461d8692a0c405d97cda043c2005277906deee659e6897e910fa, actual: 9d8d461d8692a0c405d97cda043c2005277906deee659e6897e910fa PASS
Auth hash (staging_gov_auth) - expected: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2, actual: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2 PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: d66ded73af35cea749dffcda6e4d39aa03e9ee63337a29ae16456d1fc89aa5fb
Logic hash - expected: 6649e8e8fa5a62b040669f5916e7ee29ac311a408f4128083bea33e0, actual: 6649e8e8fa5a62b040669f5916e7ee29ac311a408f4128083bea33e0 PASS
Auth hash (staging_gov_auth) - expected: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2, actual: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2 PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 071842d66f8e900b7b488af23ab6ec21cdb64f77b9e4d003cd346965554a23d9
Logic hash - expected: 943a2f856ca2dbd5ed920b8367409a9adfe80ba19b117a12d4b94718, actual: 943a2f856ca2dbd5ed920b8367409a9adfe80ba19b117a12d4b94718 PASS
Auth hash (staging_gov_auth) - expected: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2, actual: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2 PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 49f008697c7af999c0e443615bb502fc83fc9d03920bb5481c5e75915ef71dfe
Logic hash - expected: 4e326449c5d1b6a18f335368756d71404a246bf240074b6f2e37b926, actual: 4e326449c5d1b6a18f335368756d71404a246bf240074b6f2e37b926 PASS
Auth hash (staging_gov_auth) - expected: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2, actual: 23dc495611086cbe127e274a9f5df4e56e38a141b919445b878282a2 PASS
```

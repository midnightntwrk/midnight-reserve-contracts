# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-25T01:19:20.857Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash 50bb2a37a1000368463e4c70705ca85fa338b97cf88e3ac5f0f7d780
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 35dcfce052d56c7c4239157a7e4983fca34241e20fdb47847fee9742
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash c72c6653a05e0c9f781d68b8adb5c4952a5518f02707577a66f4ebf9
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 816c107480f04cdd754b46135e340f03a1dc6aea96bbcd50d1f085ca
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash ab7c0e8cc153f2d2bae7b7c511463fa58f77b82ece4be58db3227169
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 7fc6dbfad88217badd322f1ce6ded01c419f2bc9010017a9c7bb2947
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: c1301093038a7d4a741c05fb5769df0ebadee0ad50b0076c542cad6a1aac2029
Expected policy IDs (from NFTs): [22bd375bdee7ab9267115238cc36ec423fd988cec61e798cf141dac4, 50bb2a37a1000368463e4c70705ca85fa338b97cf88e3ac5f0f7d780]
Actual on-chain policy IDs:      [22bd375bdee7ab9267115238cc36ec423fd988cec61e798cf141dac4, 50bb2a37a1000368463e4c70705ca85fa338b97cf88e3ac5f0f7d780]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=b3dfcfd9d610dc8794be5dba2bbbdfe092ca586770a8862d9eb99ed1]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: f1d6eaba8eb222e41bc591caf66d83871a65e4177df1fb4548e442b17e6767a5
Expected policy IDs (from NFTs): [95fcd1c3b1e0e4e05b40de7992f6a5f6586aab5aadc2b4801d311cc7]
Actual on-chain policy IDs:      [95fcd1c3b1e0e4e05b40de7992f6a5f6586aab5aadc2b4801d311cc7]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: cff974151675b99b82c2cdd94baa56db361d2c99a66434582d4e0314adcd5e3b
Expected policy IDs (from NFTs): [35dcfce052d56c7c4239157a7e4983fca34241e20fdb47847fee9742, eacbd24804b14ba50404b5b9648ffc68ba9f715adbbe087276f913ef]
Actual on-chain policy IDs:      [35dcfce052d56c7c4239157a7e4983fca34241e20fdb47847fee9742, eacbd24804b14ba50404b5b9648ffc68ba9f715adbbe087276f913ef]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=5139e0cd3063f3a517495fb2f9934ecd39d7552fc3abbcf17ef488b7]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: ec82e782ec532720fc0f8c08695ef3a1b676a75bf9d040d225001d3678181e76
Expected policy IDs (from NFTs): [da95e2260f012ef966b6568804e264d1c756e5007e9d5795e6466435]
Actual on-chain policy IDs:      [da95e2260f012ef966b6568804e264d1c756e5007e9d5795e6466435]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 24b8d497c7da5df85a9df152d84ac99a39ea71476699dd3875c1b5cf82ba7e07
Expected policy IDs (from NFTs): [5e4dc715b5da89b1d63552a302b9878eeb4094a713e3f9d58137b257, c72c6653a05e0c9f781d68b8adb5c4952a5518f02707577a66f4ebf9]
Actual on-chain policy IDs:      [5e4dc715b5da89b1d63552a302b9878eeb4094a713e3f9d58137b257, c72c6653a05e0c9f781d68b8adb5c4952a5518f02707577a66f4ebf9]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=711d2aef14e0c391a3f214395c57f8e0b10a30ee4316ad4dfe1fe6c6]
```

### [PASS] On-chain: ics-deployment

```
Tx: 40962a0a3c47fbf2916bd373f83ab5ec92ed46b6d644875fd4227801dd37aeed
Expected policy IDs (from NFTs): [816c107480f04cdd754b46135e340f03a1dc6aea96bbcd50d1f085ca, 89940f6aa4407de7db78c743f7733adc21566950295c23045d3b5c20]
Actual on-chain policy IDs:      [816c107480f04cdd754b46135e340f03a1dc6aea96bbcd50d1f085ca, 89940f6aa4407de7db78c743f7733adc21566950295c23045d3b5c20]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=87d92cbcc6f92895172510ea6d9efabf8c7bff9d2a3c444c4538e624]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: d2d2a1985deb1ef741f4e7ce2f17e8713d0e8c43ac66aa39f4994ad6fc5772c4
Expected policy IDs (from NFTs): [be105f005109927469b37915f851bd7e28b98c2f7f209df7a464abaf]
Actual on-chain policy IDs:      [be105f005109927469b37915f851bd7e28b98c2f7f209df7a464abaf]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 0d7fd3cad36c2f03a4bb3ac8a2f519a8ba920d3e84182bdc76f52d095b4744b4
Expected policy IDs (from NFTs): [e28412dbee2e36320c7341fa395a6bd6f1c0b722467560e37bedc97f]
Actual on-chain policy IDs:      [e28412dbee2e36320c7341fa395a6bd6f1c0b722467560e37bedc97f]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 0ff53628e7b507495779e0350e593a80a62f1da9019cfee1c5ad2b9120807e24
Expected policy IDs (from NFTs): [32ee1ec1d0167b7810fc260d1bb2b2c41be717c0353de5494bd59f1f, ab7c0e8cc153f2d2bae7b7c511463fa58f77b82ece4be58db3227169]
Actual on-chain policy IDs:      [32ee1ec1d0167b7810fc260d1bb2b2c41be717c0353de5494bd59f1f, ab7c0e8cc153f2d2bae7b7c511463fa58f77b82ece4be58db3227169]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=9126cd519d71642054bc4a7ba6bc9800945de7b4f00975634866bee0]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 9519ca60516cb7cf36960c81e19d0cc4a010d8f66eb7c477ef8500bc995fe473
Expected policy IDs (from NFTs): [3effe78c550162f48bfda138ad70ba7e758c10f0fb2645e47aefb206]
Actual on-chain policy IDs:      [3effe78c550162f48bfda138ad70ba7e758c10f0fb2645e47aefb206]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 09707163a91e26136106e01e672bc945d6075f9d016ecf80e93d88e99445c092
Expected policy IDs (from NFTs): [1f6f29efaa5aa7b263cc40322e609bc31c20dc2e176901624992c9be, 7fc6dbfad88217badd322f1ce6ded01c419f2bc9010017a9c7bb2947]
Actual on-chain policy IDs:      [1f6f29efaa5aa7b263cc40322e609bc31c20dc2e176901624992c9be, 7fc6dbfad88217badd322f1ce6ded01c419f2bc9010017a9c7bb2947]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=2068f3f75901e16395a1c7d315149e83bf4cb596f54919a5ea5bb982]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: bb9e1d4cfbe816f12d06b59ce983ebd4e3e6b29e011f2d3fe3067a93c68a7d53
Expected policy IDs (from NFTs): [885f84bf92ce77e7a469ec1d53cc46a787bbca88649e0bdbf8114991]
Actual on-chain policy IDs:      [885f84bf92ce77e7a469ec1d53cc46a787bbca88649e0bdbf8114991]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: c1301093038a7d4a741c05fb5769df0ebadee0ad50b0076c542cad6a1aac2029
Logic hash - expected: b3dfcfd9d610dc8794be5dba2bbbdfe092ca586770a8862d9eb99ed1, actual: b3dfcfd9d610dc8794be5dba2bbbdfe092ca586770a8862d9eb99ed1 PASS
Auth hash (main_gov_auth) - expected: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e, actual: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: cff974151675b99b82c2cdd94baa56db361d2c99a66434582d4e0314adcd5e3b
Logic hash - expected: 5139e0cd3063f3a517495fb2f9934ecd39d7552fc3abbcf17ef488b7, actual: 5139e0cd3063f3a517495fb2f9934ecd39d7552fc3abbcf17ef488b7 PASS
Auth hash (main_gov_auth) - expected: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e, actual: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 24b8d497c7da5df85a9df152d84ac99a39ea71476699dd3875c1b5cf82ba7e07
Logic hash - expected: 711d2aef14e0c391a3f214395c57f8e0b10a30ee4316ad4dfe1fe6c6, actual: 711d2aef14e0c391a3f214395c57f8e0b10a30ee4316ad4dfe1fe6c6 PASS
Auth hash (main_gov_auth) - expected: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e, actual: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: 40962a0a3c47fbf2916bd373f83ab5ec92ed46b6d644875fd4227801dd37aeed
Logic hash - expected: 87d92cbcc6f92895172510ea6d9efabf8c7bff9d2a3c444c4538e624, actual: 87d92cbcc6f92895172510ea6d9efabf8c7bff9d2a3c444c4538e624 PASS
Auth hash (main_gov_auth) - expected: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e, actual: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 0ff53628e7b507495779e0350e593a80a62f1da9019cfee1c5ad2b9120807e24
Logic hash - expected: 9126cd519d71642054bc4a7ba6bc9800945de7b4f00975634866bee0, actual: 9126cd519d71642054bc4a7ba6bc9800945de7b4f00975634866bee0 PASS
Auth hash (main_gov_auth) - expected: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e, actual: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 09707163a91e26136106e01e672bc945d6075f9d016ecf80e93d88e99445c092
Logic hash - expected: 2068f3f75901e16395a1c7d315149e83bf4cb596f54919a5ea5bb982, actual: 2068f3f75901e16395a1c7d315149e83bf4cb596f54919a5ea5bb982 PASS
Auth hash (main_gov_auth) - expected: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e, actual: 70fb56aa1202b18d6a67bd1977796a976260f4b5d684e54d2cca4c7e PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: c1301093038a7d4a741c05fb5769df0ebadee0ad50b0076c542cad6a1aac2029
Logic hash - expected: b3dfcfd9d610dc8794be5dba2bbbdfe092ca586770a8862d9eb99ed1, actual: b3dfcfd9d610dc8794be5dba2bbbdfe092ca586770a8862d9eb99ed1 PASS
Auth hash (staging_gov_auth) - expected: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630, actual: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630 PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: cff974151675b99b82c2cdd94baa56db361d2c99a66434582d4e0314adcd5e3b
Logic hash - expected: 5139e0cd3063f3a517495fb2f9934ecd39d7552fc3abbcf17ef488b7, actual: 5139e0cd3063f3a517495fb2f9934ecd39d7552fc3abbcf17ef488b7 PASS
Auth hash (staging_gov_auth) - expected: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630, actual: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630 PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 24b8d497c7da5df85a9df152d84ac99a39ea71476699dd3875c1b5cf82ba7e07
Logic hash - expected: 711d2aef14e0c391a3f214395c57f8e0b10a30ee4316ad4dfe1fe6c6, actual: 711d2aef14e0c391a3f214395c57f8e0b10a30ee4316ad4dfe1fe6c6 PASS
Auth hash (staging_gov_auth) - expected: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630, actual: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630 PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: 40962a0a3c47fbf2916bd373f83ab5ec92ed46b6d644875fd4227801dd37aeed
Logic hash - expected: 87d92cbcc6f92895172510ea6d9efabf8c7bff9d2a3c444c4538e624, actual: 87d92cbcc6f92895172510ea6d9efabf8c7bff9d2a3c444c4538e624 PASS
Auth hash (staging_gov_auth) - expected: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630, actual: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630 PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 0ff53628e7b507495779e0350e593a80a62f1da9019cfee1c5ad2b9120807e24
Logic hash - expected: 9126cd519d71642054bc4a7ba6bc9800945de7b4f00975634866bee0, actual: 9126cd519d71642054bc4a7ba6bc9800945de7b4f00975634866bee0 PASS
Auth hash (staging_gov_auth) - expected: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630, actual: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630 PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 09707163a91e26136106e01e672bc945d6075f9d016ecf80e93d88e99445c092
Logic hash - expected: 2068f3f75901e16395a1c7d315149e83bf4cb596f54919a5ea5bb982, actual: 2068f3f75901e16395a1c7d315149e83bf4cb596f54919a5ea5bb982 PASS
Auth hash (staging_gov_auth) - expected: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630, actual: 0065f9c3e710919f453c7abee6dc5d99bde39a1c844ac29910b17630 PASS
```

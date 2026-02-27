# Deployment Verification Report

**Network:** node-dev-2
**Date:** 2026-02-25T04:13:15.297Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash ec71ad781a63d59f5b11c51d0bddaafb03021d8b93d4e88409a0608e
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 6477cea08cbfa2cba45a907d3fe676c4dfade47375f6cb859d746400
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 8c80622ceaef40c693a6ab31d3456cb1cf406bc7f31b3b4a9d984d69
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 360b11aaab0b841ec9f6377960c108a8f4965a56591e8541bf80a2bd
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash e677093330e8fe1c83680630d02821744422acff321946c32ca8c179
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash a246eb4c51b1ea8b1fe6a579f0086f12912514182ef25fb4d3d10561
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: cf8159bffe8620473a410b246d169e66d5e550a6bcffcb7f7dbf1539a43f20ab
Expected policy IDs (from NFTs): [0fbe7f34039da6180fdf66fffb54366c4ecb74c2ae69c1629847eaca, ec71ad781a63d59f5b11c51d0bddaafb03021d8b93d4e88409a0608e]
Actual on-chain policy IDs:      [0fbe7f34039da6180fdf66fffb54366c4ecb74c2ae69c1629847eaca, ec71ad781a63d59f5b11c51d0bddaafb03021d8b93d4e88409a0608e]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=318908698340fe1d11eccf4aa70044873fdb90528120d2b30699e95c]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: c2a7faf2e76c5e3c661119ad434882eff12fdb5296e6df8b143899364a3eee64
Expected policy IDs (from NFTs): [17884913f9ac1b3c566be558ce9224b6d238c0383fa33fe8fb41b982]
Actual on-chain policy IDs:      [17884913f9ac1b3c566be558ce9224b6d238c0383fa33fe8fb41b982]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: f2a0e070f4a26efd99326c43af699243121c4e9cc0adb4e98575ca80615d5733
Expected policy IDs (from NFTs): [6477cea08cbfa2cba45a907d3fe676c4dfade47375f6cb859d746400, f7eb0acf9cc3d4eba85938618c9861e6c8680092d16644454422d88e]
Actual on-chain policy IDs:      [6477cea08cbfa2cba45a907d3fe676c4dfade47375f6cb859d746400, f7eb0acf9cc3d4eba85938618c9861e6c8680092d16644454422d88e]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=d40d64579d9e3aa444fd5eabc2015d70009e551dcc649378fcf1faad]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: dc0622bd7744cf6ed0fd84f5e6ea6db327be57e5b2e53a560719638e4066f136
Expected policy IDs (from NFTs): [c6d2168134d86c5f0c9a0af8b089dd55a61def3b76c81629c1c148dc]
Actual on-chain policy IDs:      [c6d2168134d86c5f0c9a0af8b089dd55a61def3b76c81629c1c148dc]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 3e50824c5b120544923cdf1cddf8576b9a5a046d5bab679e58f3e7bb142459d5
Expected policy IDs (from NFTs): [8c80622ceaef40c693a6ab31d3456cb1cf406bc7f31b3b4a9d984d69, e64b3323ef2e281714c5a62cff026d09c047dd05a296136efd4013b5]
Actual on-chain policy IDs:      [8c80622ceaef40c693a6ab31d3456cb1cf406bc7f31b3b4a9d984d69, e64b3323ef2e281714c5a62cff026d09c047dd05a296136efd4013b5]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=ae66f8c50eb1d34db741c91cb7576b49dcaee4888fe80b3804a01a41]
```

### [PASS] On-chain: ics-deployment

```
Tx: 26d6e7ff5aa1716b78182eae2e8ff2989ed9100424485b3c1dd0ba5125a22524
Expected policy IDs (from NFTs): [360b11aaab0b841ec9f6377960c108a8f4965a56591e8541bf80a2bd, 8052a041c055c97b04cfe9c9330ca24ad773a363adff17bcb3ace29e]
Actual on-chain policy IDs:      [360b11aaab0b841ec9f6377960c108a8f4965a56591e8541bf80a2bd, 8052a041c055c97b04cfe9c9330ca24ad773a363adff17bcb3ace29e]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=73af29685bebbf47c1f72b4db315bb6601a87201e41da3508125dd93]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 27c7ca168e0e24eb79dc92d14e6af774b24c2728d8cf727f85dbccfc4bd9db95
Expected policy IDs (from NFTs): [853741c3211b17cdd5ca75cd9406e1d94b002034e41d16440b060c6e]
Actual on-chain policy IDs:      [853741c3211b17cdd5ca75cd9406e1d94b002034e41d16440b060c6e]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: b4909cdc5b4f092ee1135eee80646719f5054ca095d697282a7a42b33085fdcb
Expected policy IDs (from NFTs): [1c9ae0e7d09dc374fa6ca87e9d6349520a007957dd6bebf0d5ee01a1]
Actual on-chain policy IDs:      [1c9ae0e7d09dc374fa6ca87e9d6349520a007957dd6bebf0d5ee01a1]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: ca258fcd63248a805d32b1078cfc0a0f19c256c971419fd0d9867ccb59a56881
Expected policy IDs (from NFTs): [e677093330e8fe1c83680630d02821744422acff321946c32ca8c179, fbe760bb55bc3dc0b5dc5d687e3e925eca0e74994c60f17cfc3fcdc5]
Actual on-chain policy IDs:      [e677093330e8fe1c83680630d02821744422acff321946c32ca8c179, fbe760bb55bc3dc0b5dc5d687e3e925eca0e74994c60f17cfc3fcdc5]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=5bc9b5ed893157c26fd57299adc2e5bf788aaff422ba84f670d107c0]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 5b47313e3254d8f0bd14bd9bc9a52b66042481505870682fb3b07ecc973e00fc
Expected policy IDs (from NFTs): [784ea2ed8dd7419b652d022b33fd52bb2cc157daa678b45f809beee1]
Actual on-chain policy IDs:      [784ea2ed8dd7419b652d022b33fd52bb2cc157daa678b45f809beee1]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: 94af0b06af426def203a8e4055e40a8a0cbd80c4be8bb78cfa52ed0224d8f0ff
Expected policy IDs (from NFTs): [a246eb4c51b1ea8b1fe6a579f0086f12912514182ef25fb4d3d10561, e81f6500eb27f15ecb4ec1d6c7f55890fb24063e2ad86dfb2d62b30a]
Actual on-chain policy IDs:      [a246eb4c51b1ea8b1fe6a579f0086f12912514182ef25fb4d3d10561, e81f6500eb27f15ecb4ec1d6c7f55890fb24063e2ad86dfb2d62b30a]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=39ab1c94c83621460d0a7fa0cb13e617f064419e54f8cd1b5b3b8fce]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: d0a1e650160784b6e85ee7bfdc0b744911a0a041ae9b90d602126b7fff414063
Expected policy IDs (from NFTs): [d27e4d0fd0297cdbc57e1a1fbb74558786f0ca48de387c5220eb53d6]
Actual on-chain policy IDs:      [d27e4d0fd0297cdbc57e1a1fbb74558786f0ca48de387c5220eb53d6]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: cf8159bffe8620473a410b246d169e66d5e550a6bcffcb7f7dbf1539a43f20ab
Logic hash - expected: 318908698340fe1d11eccf4aa70044873fdb90528120d2b30699e95c, actual: 318908698340fe1d11eccf4aa70044873fdb90528120d2b30699e95c PASS
Auth hash (main_gov_auth) - expected: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e, actual: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: f2a0e070f4a26efd99326c43af699243121c4e9cc0adb4e98575ca80615d5733
Logic hash - expected: d40d64579d9e3aa444fd5eabc2015d70009e551dcc649378fcf1faad, actual: d40d64579d9e3aa444fd5eabc2015d70009e551dcc649378fcf1faad PASS
Auth hash (main_gov_auth) - expected: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e, actual: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 3e50824c5b120544923cdf1cddf8576b9a5a046d5bab679e58f3e7bb142459d5
Logic hash - expected: ae66f8c50eb1d34db741c91cb7576b49dcaee4888fe80b3804a01a41, actual: ae66f8c50eb1d34db741c91cb7576b49dcaee4888fe80b3804a01a41 PASS
Auth hash (main_gov_auth) - expected: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e, actual: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: 26d6e7ff5aa1716b78182eae2e8ff2989ed9100424485b3c1dd0ba5125a22524
Logic hash - expected: 73af29685bebbf47c1f72b4db315bb6601a87201e41da3508125dd93, actual: 73af29685bebbf47c1f72b4db315bb6601a87201e41da3508125dd93 PASS
Auth hash (main_gov_auth) - expected: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e, actual: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: ca258fcd63248a805d32b1078cfc0a0f19c256c971419fd0d9867ccb59a56881
Logic hash - expected: 5bc9b5ed893157c26fd57299adc2e5bf788aaff422ba84f670d107c0, actual: 5bc9b5ed893157c26fd57299adc2e5bf788aaff422ba84f670d107c0 PASS
Auth hash (main_gov_auth) - expected: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e, actual: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: 94af0b06af426def203a8e4055e40a8a0cbd80c4be8bb78cfa52ed0224d8f0ff
Logic hash - expected: 39ab1c94c83621460d0a7fa0cb13e617f064419e54f8cd1b5b3b8fce, actual: 39ab1c94c83621460d0a7fa0cb13e617f064419e54f8cd1b5b3b8fce PASS
Auth hash (main_gov_auth) - expected: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e, actual: 47d754479dd7ef3664e9fb2d11d71adcd6d700b8407244f406cfb90e PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: cf8159bffe8620473a410b246d169e66d5e550a6bcffcb7f7dbf1539a43f20ab
Logic hash - expected: 318908698340fe1d11eccf4aa70044873fdb90528120d2b30699e95c, actual: 318908698340fe1d11eccf4aa70044873fdb90528120d2b30699e95c PASS
Auth hash (staging_gov_auth) - expected: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b, actual: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: f2a0e070f4a26efd99326c43af699243121c4e9cc0adb4e98575ca80615d5733
Logic hash - expected: d40d64579d9e3aa444fd5eabc2015d70009e551dcc649378fcf1faad, actual: d40d64579d9e3aa444fd5eabc2015d70009e551dcc649378fcf1faad PASS
Auth hash (staging_gov_auth) - expected: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b, actual: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 3e50824c5b120544923cdf1cddf8576b9a5a046d5bab679e58f3e7bb142459d5
Logic hash - expected: ae66f8c50eb1d34db741c91cb7576b49dcaee4888fe80b3804a01a41, actual: ae66f8c50eb1d34db741c91cb7576b49dcaee4888fe80b3804a01a41 PASS
Auth hash (staging_gov_auth) - expected: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b, actual: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: 26d6e7ff5aa1716b78182eae2e8ff2989ed9100424485b3c1dd0ba5125a22524
Logic hash - expected: 73af29685bebbf47c1f72b4db315bb6601a87201e41da3508125dd93, actual: 73af29685bebbf47c1f72b4db315bb6601a87201e41da3508125dd93 PASS
Auth hash (staging_gov_auth) - expected: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b, actual: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: ca258fcd63248a805d32b1078cfc0a0f19c256c971419fd0d9867ccb59a56881
Logic hash - expected: 5bc9b5ed893157c26fd57299adc2e5bf788aaff422ba84f670d107c0, actual: 5bc9b5ed893157c26fd57299adc2e5bf788aaff422ba84f670d107c0 PASS
Auth hash (staging_gov_auth) - expected: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b, actual: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: 94af0b06af426def203a8e4055e40a8a0cbd80c4be8bb78cfa52ed0224d8f0ff
Logic hash - expected: 39ab1c94c83621460d0a7fa0cb13e617f064419e54f8cd1b5b3b8fce, actual: 39ab1c94c83621460d0a7fa0cb13e617f064419e54f8cd1b5b3b8fce PASS
Auth hash (staging_gov_auth) - expected: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b, actual: 8ab24f380e654811cad0d240a370ae978e8c06dd599f9c77f0c89a7b PASS
```

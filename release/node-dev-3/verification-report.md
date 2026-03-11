# Deployment Verification Report

**Network:** node-dev-3
**Date:** 2026-03-02T16:13:25.768Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash 1cfefd232d76533723d5641ea607360d835456403788eccb60fbbbce
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash 5fa960ba16d6f3d4af649786cd1df48d6a9addf4a2aca20ecbfa1743
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash c4855d21cf18028d497b691c56a2bdcea07462db43fd11077a067d0f
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash f1d15b2414dc4ed42bb7ad51972a9a848b503041810eae1c93b33be4
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash c6639ed64ae81c48c4cec948d037b8c5f599ac96099672dbe9de0195
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 102260b04e0ccd8e7494f62e233de20dcf2272f21adc97ce71f73722
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: 1f2fef040e786ac4a0a2b0fba8ca52c0263208f7bb5a62d0f369b9eae0384db6
Expected policy IDs (from NFTs): [1cfefd232d76533723d5641ea607360d835456403788eccb60fbbbce, 43b995b0e93b1f4a9531f9feca7ad17e57ccc5ea220424eed1c53892]
Actual on-chain policy IDs:      [1cfefd232d76533723d5641ea607360d835456403788eccb60fbbbce, 43b995b0e93b1f4a9531f9feca7ad17e57ccc5ea220424eed1c53892]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=17dc43011ee9e3d16ee137487664664ba95d9b9d0686869dd3869713]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 766526523903b620f6ed6daeba9cc2214fb900f48cfb1984e61a180b9ccfb22a
Expected policy IDs (from NFTs): [92e61d0c057e5e20199a268a4de36e25847b8e2f8b1ad810b7888082]
Actual on-chain policy IDs:      [92e61d0c057e5e20199a268a4de36e25847b8e2f8b1ad810b7888082]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: f53abc8b571ef22b2f7055e8052cb7e75999e0f108d13bb602ed884f18fbac4a
Expected policy IDs (from NFTs): [018dce422b9560ba7b902c2f241f020cdecae8b76407696a57b9ab23, 5fa960ba16d6f3d4af649786cd1df48d6a9addf4a2aca20ecbfa1743]
Actual on-chain policy IDs:      [018dce422b9560ba7b902c2f241f020cdecae8b76407696a57b9ab23, 5fa960ba16d6f3d4af649786cd1df48d6a9addf4a2aca20ecbfa1743]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=645a507d56e2815885b9e434e1a768475d4725ab5e208590d3e318a4]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: a4a9d7505e4fb23e18e6152140cb48e9ea2fa5147527c5d91eaafcc4ecdfc210
Expected policy IDs (from NFTs): [e62f17b479e4088376118bcd491726da5b80a6f7b81154743f4a7c07]
Actual on-chain policy IDs:      [e62f17b479e4088376118bcd491726da5b80a6f7b81154743f4a7c07]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: 30657f488fd4119585112a2c717698d62c26254cf7d2d6c62ca9acf4fe1b1eef
Expected policy IDs (from NFTs): [3e2d145b45dde66c9dfbd2a6fd727491c2cd6f761704e71cec7a4975, c4855d21cf18028d497b691c56a2bdcea07462db43fd11077a067d0f]
Actual on-chain policy IDs:      [3e2d145b45dde66c9dfbd2a6fd727491c2cd6f761704e71cec7a4975, c4855d21cf18028d497b691c56a2bdcea07462db43fd11077a067d0f]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=c3c8984c296bf7a92d81551eb037fc3d4081c724383feeab1ed71f06]
```

### [PASS] On-chain: ics-deployment

```
Tx: 3088f2bf05a22a8ec53e0cf01682ee3899db21ddb7378fdbf7b2019d05acf832
Expected policy IDs (from NFTs): [23950b7cdc7eb3bbc43402eead83e4fa9d13844a6a51209216ba570e, f1d15b2414dc4ed42bb7ad51972a9a848b503041810eae1c93b33be4]
Actual on-chain policy IDs:      [23950b7cdc7eb3bbc43402eead83e4fa9d13844a6a51209216ba570e, f1d15b2414dc4ed42bb7ad51972a9a848b503041810eae1c93b33be4]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=2dbf100e1655c5d34001eddd1de946009e4f3231a82c06606c94095f]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: 69aae61800c8553e69947b6fad510384aedeb3656a3aa4b8d452398939f99574
Expected policy IDs (from NFTs): [04a4b79e4ce2268b91aabab350c351540918303460d711ce6676d275]
Actual on-chain policy IDs:      [04a4b79e4ce2268b91aabab350c351540918303460d711ce6676d275]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 8789d6459367a3e19d06a4f024e62e932c409c54f7c3f93378e4d51f437e72ed
Expected policy IDs (from NFTs): [8cb9b070a745d0d284c5ade5f222d327b376996aa8d0c770b17d233a]
Actual on-chain policy IDs:      [8cb9b070a745d0d284c5ade5f222d327b376996aa8d0c770b17d233a]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: 36fee2068ee0d7acc230dc6271fdd8b462194abdfbb6b3fc8efae1e79e36dc24
Expected policy IDs (from NFTs): [32c7f04acf2f5f809c1dea5d2e0a9b04c05aef34c795c872beac1685, c6639ed64ae81c48c4cec948d037b8c5f599ac96099672dbe9de0195]
Actual on-chain policy IDs:      [32c7f04acf2f5f809c1dea5d2e0a9b04c05aef34c795c872beac1685, c6639ed64ae81c48c4cec948d037b8c5f599ac96099672dbe9de0195]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=c75ed53802ba7229004d72986ca1c67ed3095681914ca5b63516ad1d]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 684c4402c7a4a74c24b3a06d645090427f73aa976e713c5b88129a8a6fc45e92
Expected policy IDs (from NFTs): [90d0af253184a8394507dbcbe1706f58866057cc10f4b109d2cd47ea]
Actual on-chain policy IDs:      [90d0af253184a8394507dbcbe1706f58866057cc10f4b109d2cd47ea]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: f48b9f43ac9ca68810ed2ba77e536469be9f22253dea6e9f40f20ad1c74de0a3
Expected policy IDs (from NFTs): [102260b04e0ccd8e7494f62e233de20dcf2272f21adc97ce71f73722, 34ac9204cf96169d920f429ec84a880d4e56f94a26884685fff88506]
Actual on-chain policy IDs:      [102260b04e0ccd8e7494f62e233de20dcf2272f21adc97ce71f73722, 34ac9204cf96169d920f429ec84a880d4e56f94a26884685fff88506]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=00fcd89289a0daa92771381a4e731ad169d382ae5bd579cbcaf68b59]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: 8e961c97ae20461c4cbc36dd4d2660f64cd83951e1d522c4d0cd185c230f252f
Expected policy IDs (from NFTs): [88bee628058813b1d14521ae9ce55b846662659a6d982530e0aff69d]
Actual on-chain policy IDs:      [88bee628058813b1d14521ae9ce55b846662659a6d982530e0aff69d]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: 1f2fef040e786ac4a0a2b0fba8ca52c0263208f7bb5a62d0f369b9eae0384db6
Logic hash - expected: 17dc43011ee9e3d16ee137487664664ba95d9b9d0686869dd3869713, actual: 17dc43011ee9e3d16ee137487664664ba95d9b9d0686869dd3869713 PASS
Auth hash (main_gov_auth) - expected: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8, actual: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8 PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: f53abc8b571ef22b2f7055e8052cb7e75999e0f108d13bb602ed884f18fbac4a
Logic hash - expected: 645a507d56e2815885b9e434e1a768475d4725ab5e208590d3e318a4, actual: 645a507d56e2815885b9e434e1a768475d4725ab5e208590d3e318a4 PASS
Auth hash (main_gov_auth) - expected: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8, actual: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8 PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: 30657f488fd4119585112a2c717698d62c26254cf7d2d6c62ca9acf4fe1b1eef
Logic hash - expected: c3c8984c296bf7a92d81551eb037fc3d4081c724383feeab1ed71f06, actual: c3c8984c296bf7a92d81551eb037fc3d4081c724383feeab1ed71f06 PASS
Auth hash (main_gov_auth) - expected: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8, actual: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8 PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: 3088f2bf05a22a8ec53e0cf01682ee3899db21ddb7378fdbf7b2019d05acf832
Logic hash - expected: 2dbf100e1655c5d34001eddd1de946009e4f3231a82c06606c94095f, actual: 2dbf100e1655c5d34001eddd1de946009e4f3231a82c06606c94095f PASS
Auth hash (main_gov_auth) - expected: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8, actual: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8 PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: 36fee2068ee0d7acc230dc6271fdd8b462194abdfbb6b3fc8efae1e79e36dc24
Logic hash - expected: c75ed53802ba7229004d72986ca1c67ed3095681914ca5b63516ad1d, actual: c75ed53802ba7229004d72986ca1c67ed3095681914ca5b63516ad1d PASS
Auth hash (main_gov_auth) - expected: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8, actual: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8 PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: f48b9f43ac9ca68810ed2ba77e536469be9f22253dea6e9f40f20ad1c74de0a3
Logic hash - expected: 00fcd89289a0daa92771381a4e731ad169d382ae5bd579cbcaf68b59, actual: 00fcd89289a0daa92771381a4e731ad169d382ae5bd579cbcaf68b59 PASS
Auth hash (main_gov_auth) - expected: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8, actual: 6b51a0c0a7d879678a1f226a0e7f441507d64505ec03f3b0eba35ca8 PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: 1f2fef040e786ac4a0a2b0fba8ca52c0263208f7bb5a62d0f369b9eae0384db6
Logic hash - expected: 17dc43011ee9e3d16ee137487664664ba95d9b9d0686869dd3869713, actual: 17dc43011ee9e3d16ee137487664664ba95d9b9d0686869dd3869713 PASS
Auth hash (staging_gov_auth) - expected: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856, actual: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856 PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: f53abc8b571ef22b2f7055e8052cb7e75999e0f108d13bb602ed884f18fbac4a
Logic hash - expected: 645a507d56e2815885b9e434e1a768475d4725ab5e208590d3e318a4, actual: 645a507d56e2815885b9e434e1a768475d4725ab5e208590d3e318a4 PASS
Auth hash (staging_gov_auth) - expected: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856, actual: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856 PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: 30657f488fd4119585112a2c717698d62c26254cf7d2d6c62ca9acf4fe1b1eef
Logic hash - expected: c3c8984c296bf7a92d81551eb037fc3d4081c724383feeab1ed71f06, actual: c3c8984c296bf7a92d81551eb037fc3d4081c724383feeab1ed71f06 PASS
Auth hash (staging_gov_auth) - expected: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856, actual: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856 PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: 3088f2bf05a22a8ec53e0cf01682ee3899db21ddb7378fdbf7b2019d05acf832
Logic hash - expected: 2dbf100e1655c5d34001eddd1de946009e4f3231a82c06606c94095f, actual: 2dbf100e1655c5d34001eddd1de946009e4f3231a82c06606c94095f PASS
Auth hash (staging_gov_auth) - expected: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856, actual: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856 PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: 36fee2068ee0d7acc230dc6271fdd8b462194abdfbb6b3fc8efae1e79e36dc24
Logic hash - expected: c75ed53802ba7229004d72986ca1c67ed3095681914ca5b63516ad1d, actual: c75ed53802ba7229004d72986ca1c67ed3095681914ca5b63516ad1d PASS
Auth hash (staging_gov_auth) - expected: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856, actual: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856 PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: f48b9f43ac9ca68810ed2ba77e536469be9f22253dea6e9f40f20ad1c74de0a3
Logic hash - expected: 00fcd89289a0daa92771381a4e731ad169d382ae5bd579cbcaf68b59, actual: 00fcd89289a0daa92771381a4e731ad169d382ae5bd579cbcaf68b59 PASS
Auth hash (staging_gov_auth) - expected: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856, actual: 92c41d0404a3a369e814785eb73bc599b7663280eca4632cb82ee856 PASS
```

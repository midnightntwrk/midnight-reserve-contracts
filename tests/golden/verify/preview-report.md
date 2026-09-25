# Deployment Verification Report

**Network:** preview
**Date:** 2026-09-25T00:15:33.142Z
**Result:** ALL CHECKS PASSED
**Summary:** 31 passed, 0 failed, 31 total

---

## Check 1: Forever Script -> Two-Stage Embedding

### [PASS] Embedding: tech_auth_forever contains tech_auth_two_stage_upgrade hash

```
PASS: tech_auth_forever compiledCode contains two-stage hash 56fd55acd7aa8e1e3d5a710375056a42fdb9bd67aa02797c82dc7246
```

### [PASS] Embedding: council_forever contains council_two_stage_upgrade hash

```
PASS: council_forever compiledCode contains two-stage hash b7ba80b5ef66c9371d095715d0269e8e853cfd5bf430648aad0c5307
```

### [PASS] Embedding: reserve_forever contains reserve_two_stage_upgrade hash

```
PASS: reserve_forever compiledCode contains two-stage hash 74f126f93dc650a08cf357e03bb82ea67fdece36b6bcdb66acd71ec5
```

### [PASS] Embedding: ics_forever contains ics_two_stage_upgrade hash

```
PASS: ics_forever compiledCode contains two-stage hash 3d1951c6f403f21c19cb99db56efdbdb41fdb9f33fd9a169b384458a
```

### [PASS] Embedding: federated_ops_forever contains federated_ops_two_stage_upgrade hash

```
PASS: federated_ops_forever compiledCode contains two-stage hash ef47c29414317d7e7b7ce19091687eecd7ee6c301ae4f6cdcad30ad0
```

### [PASS] Embedding: terms_and_conditions_forever contains terms_and_conditions_two_stage_upgrade hash

```
PASS: terms_and_conditions_forever compiledCode contains two-stage hash 1f709a8a24c5e6372ef0182b8cde6af4a322896f4f7c086a6170548f
```

## Check 2: On-Chain Script Hash Verification

### [PASS] Deployment transactions: expected descriptions

```
PASS: All 12 expected deployment descriptions present, no unexpected ones.
```

### [PASS] On-chain: technical-authority-deployment

```
Tx: 61e4d39caefb83cc2971aeb0a7716066a11769652066dec87299eed6e8535271
Expected policy IDs (from NFTs): [36fa16dde420da4ccf4a15477ef1890eb64ab3f95a0919da009a4eeb, 56fd55acd7aa8e1e3d5a710375056a42fdb9bd67aa02797c82dc7246]
Actual on-chain policy IDs:      [36fa16dde420da4ccf4a15477ef1890eb64ab3f95a0919da009a4eeb, 56fd55acd7aa8e1e3d5a710375056a42fdb9bd67aa02797c82dc7246]
PASS

Logic script(s) verified via UpgradeState datum: [tech_auth_logic=438831ffaf34df793035d293f6c93d40fd3a9bbe4ada168079cfd2b5]
```

### [PASS] On-chain: tech-auth-update-threshold-deployment

```
Tx: 89002674b7c39e35f1b33f5ee71f9240da34631dd38ae6170c39fff0f1a344d7
Expected policy IDs (from NFTs): [c74f962ed9615546ace0f9ca80f224c1da661ce2b7a8b898153b2197]
Actual on-chain policy IDs:      [c74f962ed9615546ace0f9ca80f224c1da661ce2b7a8b898153b2197]
PASS
```

### [PASS] On-chain: council-deployment

```
Tx: f3e45a19e0f14871c7b8d211af6bc438fd79a1893438b5a71c8c0903f0eba155
Expected policy IDs (from NFTs): [b7ba80b5ef66c9371d095715d0269e8e853cfd5bf430648aad0c5307, d9a6750d8e5929157913ffd67362ef94556fdf73798b9fa5097b7af7]
Actual on-chain policy IDs:      [b7ba80b5ef66c9371d095715d0269e8e853cfd5bf430648aad0c5307, d9a6750d8e5929157913ffd67362ef94556fdf73798b9fa5097b7af7]
PASS

Logic script(s) verified via UpgradeState datum: [council_logic=4bd59f22fc24efd4187b6d6de07df852eb295cecc31a921636d09e6c]
```

### [PASS] On-chain: council-update-threshold-deployment

```
Tx: f52caa69afed5ebd3479a4f86aa90bdc79d0625af032807e0617cc625e4b79a8
Expected policy IDs (from NFTs): [91abe46fb535c3ae2fef4e69ee263d8de7947092c473742dee5218ae]
Actual on-chain policy IDs:      [91abe46fb535c3ae2fef4e69ee263d8de7947092c473742dee5218ae]
PASS
```

### [PASS] On-chain: reserve-deployment

```
Tx: c708807c72084d833c5a5dad49fd0d6a2b7ea3f4c36843ebb0d3a0f8eb902c55
Expected policy IDs (from NFTs): [74f126f93dc650a08cf357e03bb82ea67fdece36b6bcdb66acd71ec5, 7c339fbf3a73d1217aea49f519c83498a08f3269b6d5ba88c1c44b63]
Actual on-chain policy IDs:      [74f126f93dc650a08cf357e03bb82ea67fdece36b6bcdb66acd71ec5, 7c339fbf3a73d1217aea49f519c83498a08f3269b6d5ba88c1c44b63]
PASS

Logic script(s) verified via UpgradeState datum: [reserve_logic=4e6fa75343b4360794920efdb2e1c67812c0c587913e94316bda59d9]
```

### [PASS] On-chain: ics-deployment

```
Tx: a69082580f3dfc1a5a1357d19fb879f17d78b5c12eb4275bbd891ee838c0e8f4
Expected policy IDs (from NFTs): [3d1951c6f403f21c19cb99db56efdbdb41fdb9f33fd9a169b384458a, 565d7f9bfeff1f278e3456fa45cd792514ef55fcb6e6b9a1212d1e10]
Actual on-chain policy IDs:      [3d1951c6f403f21c19cb99db56efdbdb41fdb9f33fd9a169b384458a, 565d7f9bfeff1f278e3456fa45cd792514ef55fcb6e6b9a1212d1e10]
PASS

Logic script(s) verified via UpgradeState datum: [ics_logic=0498bb4473cef9c7e2a45181142d3a2ec84d1c52f1b7a58efbdc3d44]
```

### [PASS] On-chain: main-gov-threshold-deployment

```
Tx: deb4cb2e6f8eaac66725aa7ef57d0776aedec505eb52011a0a1c1b55acaedbe5
Expected policy IDs (from NFTs): [e963daa2bcd6ea22186a2989d604d60154e86354e92613590f22df31]
Actual on-chain policy IDs:      [e963daa2bcd6ea22186a2989d604d60154e86354e92613590f22df31]
PASS
```

### [PASS] On-chain: staging-gov-threshold-deployment

```
Tx: 333d9c1994e0f70ad21d7eba4e4c2d4b5c251d7968214e8642ad22b56b081f76
Expected policy IDs (from NFTs): [5d78ab54039f323353cec57eee255cc60094693099af74cccce66e17]
Actual on-chain policy IDs:      [5d78ab54039f323353cec57eee255cc60094693099af74cccce66e17]
PASS
```

### [PASS] On-chain: federated-ops-deployment

```
Tx: a3df72ca2146e9d5e7ab74bf5de7b93cb5b75352c12d09b9dee01ac6ccc0866e
Expected policy IDs (from NFTs): [d9ca80815c85747710ea53e6bbf0df9de9bef10a7dfb9255ed78fdb5, ef47c29414317d7e7b7ce19091687eecd7ee6c301ae4f6cdcad30ad0]
Actual on-chain policy IDs:      [d9ca80815c85747710ea53e6bbf0df9de9bef10a7dfb9255ed78fdb5, ef47c29414317d7e7b7ce19091687eecd7ee6c301ae4f6cdcad30ad0]
PASS

Logic script(s) verified via UpgradeState datum: [federated_ops_logic=11cbe0307d5e8a112d6813cc0741a374f9e2d8ebabdabf6702b11c38]
```

### [PASS] On-chain: federated-ops-update-threshold-deployment

```
Tx: 605469414f3b50102b178f65d9edd511d0b1a7a55b4d5ac9bf226002763ab198
Expected policy IDs (from NFTs): [d6285e93df1f3639f28f9fd6e1a75e5bf901784a11d968cdb65f6c4e]
Actual on-chain policy IDs:      [d6285e93df1f3639f28f9fd6e1a75e5bf901784a11d968cdb65f6c4e]
PASS
```

### [PASS] On-chain: terms-and-conditions-deployment

```
Tx: d739dadcd0500fcde587f5b01726868ad6384eb3504447cb294ef886f8506e6b
Expected policy IDs (from NFTs): [1f709a8a24c5e6372ef0182b8cde6af4a322896f4f7c086a6170548f, b8216d5b16b644aad180e761d3ac7f8d470e8a79c5f81a4c5e1fc8e0]
Actual on-chain policy IDs:      [1f709a8a24c5e6372ef0182b8cde6af4a322896f4f7c086a6170548f, b8216d5b16b644aad180e761d3ac7f8d470e8a79c5f81a4c5e1fc8e0]
PASS

Logic script(s) verified via UpgradeState datum: [terms_and_conditions_logic=9f103dcc4840ce0633d7b29c464f6716a72dfb410060d7a4f28e26fc]
```

### [PASS] On-chain: terms-and-conditions-threshold-deployment

```
Tx: 8b5e4897b4d959804936ccad77d62dcd5bdfa473c627a9973115774eeba5fde4
Expected policy IDs (from NFTs): [88453fdda48e072cb0f864431d15d0e7c6343db6e016b1603a6f5772]
Actual on-chain policy IDs:      [88453fdda48e072cb0f864431d15d0e7c6343db6e016b1603a6f5772]
PASS
```

## Check 3: UpgradeState Datum Verification (Main Outputs)

### [PASS] UpgradeState (main): technical-authority-deployment

```
Tx: 61e4d39caefb83cc2971aeb0a7716066a11769652066dec87299eed6e8535271
Logic hash - expected: 438831ffaf34df793035d293f6c93d40fd3a9bbe4ada168079cfd2b5, actual: 438831ffaf34df793035d293f6c93d40fd3a9bbe4ada168079cfd2b5 PASS
Auth hash (main_gov_auth) - expected: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449, actual: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449 PASS
```

### [PASS] UpgradeState (main): council-deployment

```
Tx: f3e45a19e0f14871c7b8d211af6bc438fd79a1893438b5a71c8c0903f0eba155
Logic hash - expected: 4bd59f22fc24efd4187b6d6de07df852eb295cecc31a921636d09e6c, actual: 4bd59f22fc24efd4187b6d6de07df852eb295cecc31a921636d09e6c PASS
Auth hash (main_gov_auth) - expected: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449, actual: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449 PASS
```

### [PASS] UpgradeState (main): reserve-deployment

```
Tx: c708807c72084d833c5a5dad49fd0d6a2b7ea3f4c36843ebb0d3a0f8eb902c55
Logic hash - expected: 4e6fa75343b4360794920efdb2e1c67812c0c587913e94316bda59d9, actual: 4e6fa75343b4360794920efdb2e1c67812c0c587913e94316bda59d9 PASS
Auth hash (main_gov_auth) - expected: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449, actual: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449 PASS
```

### [PASS] UpgradeState (main): ics-deployment

```
Tx: a69082580f3dfc1a5a1357d19fb879f17d78b5c12eb4275bbd891ee838c0e8f4
Logic hash - expected: 0498bb4473cef9c7e2a45181142d3a2ec84d1c52f1b7a58efbdc3d44, actual: 0498bb4473cef9c7e2a45181142d3a2ec84d1c52f1b7a58efbdc3d44 PASS
Auth hash (main_gov_auth) - expected: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449, actual: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449 PASS
```

### [PASS] UpgradeState (main): federated-ops-deployment

```
Tx: a3df72ca2146e9d5e7ab74bf5de7b93cb5b75352c12d09b9dee01ac6ccc0866e
Logic hash - expected: 11cbe0307d5e8a112d6813cc0741a374f9e2d8ebabdabf6702b11c38, actual: 11cbe0307d5e8a112d6813cc0741a374f9e2d8ebabdabf6702b11c38 PASS
Auth hash (main_gov_auth) - expected: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449, actual: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449 PASS
```

### [PASS] UpgradeState (main): terms-and-conditions-deployment

```
Tx: d739dadcd0500fcde587f5b01726868ad6384eb3504447cb294ef886f8506e6b
Logic hash - expected: 9f103dcc4840ce0633d7b29c464f6716a72dfb410060d7a4f28e26fc, actual: 9f103dcc4840ce0633d7b29c464f6716a72dfb410060d7a4f28e26fc PASS
Auth hash (main_gov_auth) - expected: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449, actual: eaf2717db852150f3babc59adf39411c2f471762857642f2423f7449 PASS
```

## Check 4: UpgradeState Datum Verification (Staging Outputs)

### [PASS] UpgradeState (staging): technical-authority-deployment

```
Tx: 61e4d39caefb83cc2971aeb0a7716066a11769652066dec87299eed6e8535271
Logic hash - expected: 438831ffaf34df793035d293f6c93d40fd3a9bbe4ada168079cfd2b5, actual: 438831ffaf34df793035d293f6c93d40fd3a9bbe4ada168079cfd2b5 PASS
Auth hash (staging_gov_auth) - expected: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00, actual: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00 PASS
```

### [PASS] UpgradeState (staging): council-deployment

```
Tx: f3e45a19e0f14871c7b8d211af6bc438fd79a1893438b5a71c8c0903f0eba155
Logic hash - expected: 4bd59f22fc24efd4187b6d6de07df852eb295cecc31a921636d09e6c, actual: 4bd59f22fc24efd4187b6d6de07df852eb295cecc31a921636d09e6c PASS
Auth hash (staging_gov_auth) - expected: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00, actual: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00 PASS
```

### [PASS] UpgradeState (staging): reserve-deployment

```
Tx: c708807c72084d833c5a5dad49fd0d6a2b7ea3f4c36843ebb0d3a0f8eb902c55
Logic hash - expected: 4e6fa75343b4360794920efdb2e1c67812c0c587913e94316bda59d9, actual: 4e6fa75343b4360794920efdb2e1c67812c0c587913e94316bda59d9 PASS
Auth hash (staging_gov_auth) - expected: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00, actual: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00 PASS
```

### [PASS] UpgradeState (staging): ics-deployment

```
Tx: a69082580f3dfc1a5a1357d19fb879f17d78b5c12eb4275bbd891ee838c0e8f4
Logic hash - expected: 0498bb4473cef9c7e2a45181142d3a2ec84d1c52f1b7a58efbdc3d44, actual: 0498bb4473cef9c7e2a45181142d3a2ec84d1c52f1b7a58efbdc3d44 PASS
Auth hash (staging_gov_auth) - expected: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00, actual: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00 PASS
```

### [PASS] UpgradeState (staging): federated-ops-deployment

```
Tx: a3df72ca2146e9d5e7ab74bf5de7b93cb5b75352c12d09b9dee01ac6ccc0866e
Logic hash - expected: 11cbe0307d5e8a112d6813cc0741a374f9e2d8ebabdabf6702b11c38, actual: 11cbe0307d5e8a112d6813cc0741a374f9e2d8ebabdabf6702b11c38 PASS
Auth hash (staging_gov_auth) - expected: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00, actual: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00 PASS
```

### [PASS] UpgradeState (staging): terms-and-conditions-deployment

```
Tx: d739dadcd0500fcde587f5b01726868ad6384eb3504447cb294ef886f8506e6b
Logic hash - expected: 9f103dcc4840ce0633d7b29c464f6716a72dfb410060d7a4f28e26fc, actual: 9f103dcc4840ce0633d7b29c464f6716a72dfb410060d7a4f28e26fc PASS
Auth hash (staging_gov_auth) - expected: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00, actual: eaccc0787bc90a50cbddb2b1cdfa46208460993b26e17e2257d9ee00 PASS
```

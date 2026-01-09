# Spec

## Reserve Validators
- `reserve_forever`
  Minting / setup constraints:
  - RF-1: rebuild `config.reserve_one_shot_{hash,index}` as the authorising input for forever minting.
  - RF-2: delegate mint-time enforcement to `forever_contract`, which applies FC-1 through FC-9 plus the ILM series.
  - FC-1: spend `config.reserve_one_shot_{hash,index}` while minting exactly one reserve forever NFT (asset name "") and expose its datum.
  - FC-2: inline datum provided to `reserve_init_validation` must exist (trivial True for reserve).
  - FC-3: touch `config.cnight_policy` to keep the helper code in the script hash (no ledger constraint).
  - ILM-1: consume the configured reserve one-shot UTXO.
  - ILM-2: mint must include the reserve policy id.
  - ILM-3: minted assets under the reserve policy must be exactly one token named "".
  - ILM-4: outputs must route that token to the reserve script address with an inline datum.
  Spending / operational constraints:
  - FC-4: reference inputs must include the reserve two-stage main NFT (`config.reserve_two_stage_hash`, name "main").
  - FC-5: referenced upgrade datum must be inline.
  - FC-6: datum must encode main and mitigation logic hashes in the leading fields.
  - FC-7: datum must provide a 28-byte main logic hash for extraction.
  - FC-8: datum must provide a 28-byte mitigation logic hash for extraction.
  - FC-9: withdrawals must include credentials for both hashes (RUN-1, RUN-2, RUN-3).
  - GOS-1: outputs must pay the reserve forever NFT to the reserve script credential.
  - GOS-2: reserve output must hold only that NFT.
  - GOS-3: reserve output must provide an inline datum.
  - SING-1: reserve forever value must not carry additional assets.
  - RUN-1: withdrawals must include the credential encoded by the reserve main auth hash.
  - RUN-2: mitigation auth credential may be omitted only when the datum stores the empty hash.
  - RUN-3: when the datum stores a mitigation auth hash, withdrawals must include that credential.
  Implementation notes:
  - RV-1: `reserve_init_validation` intentionally adds no extra datum or redeemer checks beyond the forever helper.
- `reserve_two_stage_upgrade`
  Minting / setup constraints (when info is `Minting`):
  - TS-1: mint both reserve stage NFTs with inline datums while spending the reserve one-shot UTXO.
  - TSM-5: mint must include entries under the reserve policy id.
  - TSM-6: minted assets must be exactly one "main" and one "staging" token.
  - TSM-7: reserve one-shot UTXO must be spent.
  - TSM-8: main upgrade output must pay the reserve script with an inline datum.
  - TSM-9: main upgrade output must use the reserve script credential.
  - TSM-10: main upgrade output must carry the reserve main NFT.
  - TSM-11: initial main logic hash must be 28 bytes.
  - TSM-12: initial main auth hash must be 28 bytes.
  - TSM-13: staging upgrade output must pay the reserve script with an inline datum.
  - TSM-14: staging upgrade output must use the reserve script credential.
  - TSM-15: staging upgrade output must carry the staging NFT.
  - TSM-16: initial staging logic hash must be 28 bytes.
  - TSM-17: initial staging auth hash must be 28 bytes.
  - TSM-18: cnight comparison kept only to anchor the helper in the hash.
  Spending / operational constraints (when info is `Spending`):
  - TS-2: the ledger-selected reserve script input must be consumed.
  - TS-3: consumed input must be locked by the reserve script.
  - TS-4: redeemer must decode into `TwoStageRedeemer`.
  - TS-5: code must read the NFT identity from the spending input.
  - TSM-1: main-branch spends must consume the reserve main NFT.
  - TSM-2: main branch must reference the staging UTXO named in the redeemer.
  - TSM-3: referenced staging UTXO must be locked by the reserve script.
  - TSM-4: referenced staging UTXO must hold the staging NFT.
  - TSS-1: staging branch must consume the staging NFT.
  - TSS-2: staging branch must reference the main UTXO locked by the reserve script.
  - TSS-3: referenced main UTXO must hold the main NFT.
  - TM-1: spending datum must be inline.
  - TM-2: referenced staging datum must be inline.
  - TM-3: spending datum must decode to `UpgradeState`.
  - TM-4: withdrawals must include both auth credentials stored in the main datum.
  - TM-5: staging datum must provide the next logic hash.
  - TM-6: staging datum must provide the next auth hash.
  - TM-7: mitigation logic hash may only transition from empty once.
  - TM-8: staging datum must provide the new mitigation logic hash when set.
  - TM-9: mitigation auth hash may only transition from empty once.
  - TSG-1: redeemer script hash must be 28 bytes.
  - TSG-2: staging datum must be inline.
  - TSG-3: referenced main datum must be inline.
  - TSG-4: staging datum must decode to `UpgradeState`.
  - TSG-5: main datum must decode to `UpgradeState` for comparison.
  - TSG-6: withdrawals must include either the staging auth pair or the main auth pair.
  - TSG-7: staging branch may not set mitigation logic once the main datum already holds one.
  - TSG-8: staging branch may not set mitigation auth once the main datum already holds one.
  - TS-6: outputs must include a replacement reserve UTXO locked by the script credential.
  - TS-7: replacement output must carry the same NFT that was spent.
  - TS-8: replacement output must carry the evolved state as an inline datum.
  - RUN-1, RUN-2, RUN-3: same withdrawal credential requirements as above.
  Implementation notes:
  - RU-2: upgrade transactions must reference `config.reserve_one_shot_{hash,index}` as the gating one-shot input.
  - RU-3: two-stage validation is delegated to `two_stage_upgradable`, which enforces the TS, TSM, TSS, TM, TSG, and RUN constraints listed above.
- `reserve_logic`
  Operational constraints:
  - LM-0: transaction must create an output locked by the reserve script credential.
  - LM-1: sum every input guarded by the reserve credential to determine the required post-merge balance.
  - LM-2: replacement reserve output must carry inline datum data (datum hashes are rejected).
  - LM-3: reserve logic must never consume the reserve forever NFT while merging values.
  - LM-4: replacement reserve output must return at least the aggregated ADA and NIGHT balances under the reserve policy.
  Implementation notes:
  - RL-1: the validator exposes its `ScriptContext` to the shared logic helper.
  - RL-2: balance enforcement is delegated to `logic_merge`, which applies LM-0 through LM-4.

## Dust Production Validator
- `cnight_generates_dust`
  Minting / setup constraints (redeemer = `Create`):
  - DG-1: transactions must consume the ledger-selected input captured by `input_linked_mint` to keep each NFT tied to a single UTxO.
  - DG-2: emitted datums must decode to `DustMappingDatum`.
  - DG-3: recorded `dust_address` values must not exceed 33 bytes.
  - DG-4: if `c_wallet` is a verification key, that key must be present in `extra_signatories`.
  - DG-5: if `c_wallet` is a script credential, that credential must appear in withdrawals.
  Burn constraints (redeemer ≠ `Create`):
  - DG-11: the mint map must record the negated count of consumed dust NFTs so every burn is balanced.
  - DG-12: the minted policy id must differ from `config.cnight_policy` to keep the helper anchored in the hash.
  Withdrawal / batch update constraints (`Withdrawing`):
  - DG-6: reward withdrawals must reference the dust script credential.
  - DG-7: each paired replacement output must carry exactly one dust NFT.
  - DG-8: replacement outputs must retain the same NFT identity as the spent input.
  - DG-9: replacement outputs must store inline datums.
  - DG-10: replacement datums must decode to `DustMappingDatum`, satisfy the 33-byte limit, and re-check DG-4/DG-5.
  Spending / operational constraints (`Spending`):
  - DG-13: script inputs must provide inline `DustMappingDatum` records.
  - DG-14: retrieve the ledger-selected input’s script credential and reuse it for the mint/withdrawal gates below.
  - DG-15: each spend must either burn dust NFTs (negative mint quantity) or include a script withdrawal when mint quantity is zero.

## Council Validators
- `council_forever`
  Minting / setup constraints:
  - CF-1: rebuild `config.council_one_shot_{hash,index}` as the mint authoriser.
  - CF-2: execution delegates to `forever_contract`, which enforces FC-1 through FC-9 plus the ILM series for council parameters.
  - FC-1: consume `config.council_one_shot_{hash,index}` while minting exactly one council forever NFT (asset name "") and expose its datum.
  - FC-2: inline datum must satisfy `validate_multisig_structure`.
  - FC-3: touch `config.cnight_policy` to keep the helper in the script hash (no ledger constraint).
  - ILM-1: inputs must spend the council one-shot UTXO.
  - ILM-2: mint must include the council policy id.
  - ILM-3: minted assets under that policy must be exactly one council forever NFT (asset name "").
  - ILM-4: outputs must deliver that NFT to the council script address with an inline datum.
  Operational constraints:
  - FC-4: reference inputs must include the council two-stage main NFT (`config.council_two_stage_hash`, name "main").
  - FC-5: referenced upgrade datum must be inline.
  - FC-6: datum must encode council main and mitigation logic hashes.
  - FC-7: datum must provide a 28-byte council main logic hash.
  - FC-8: datum must provide a 28-byte council mitigation logic hash.
  - FC-9: withdrawals must include credentials for both hashes (RUN tags below).
  - GOS-1: council forever NFT must remain at the council script credential.
  - GOS-2: council forever output must hold only that NFT.
  - GOS-3: council forever output must provide an inline datum.
  - SING-1: council forever value must not carry additional assets.
  - RUN-1: withdrawals must include the council main auth credential.
  - RUN-2: mitigation auth credential may be omitted only when the datum records the empty hash.
  - RUN-3: when the datum records a mitigation auth hash, withdrawals must include that credential.
  - MS-1: council forever datum must be a `Multisig`.
  - MS-2: council redeemer must be a map of signer payloads.
  - MS-3: reconstructing the council signer list from the redeemer must succeed.
  - MS-4: reconstructed council signer list and total must match the datum.
- `council_two_stage_upgrade`
  Minting / setup constraints (info = `Minting`):
  - TS-1: mint both council stage NFTs with inline datums while spending the council one-shot UTXO.
  - TSM-5: mint must include entries under the council policy id.
  - TSM-6: minted assets must be exactly one "main" and one "staging" council upgrade NFT.
  - TSM-7: council one-shot UTXO must be spent.
  - TSM-8: main upgrade output must pay the council script with an inline datum.
  - TSM-9: main upgrade output must use the council script credential.
  - TSM-10: main upgrade output must carry the council main NFT.
  - TSM-11: initial main logic hash must be 28 bytes.
  - TSM-12: initial main auth hash must be 28 bytes.
  - TSM-13: staging upgrade output must pay the council script with an inline datum.
  - TSM-14: staging upgrade output must use the council script credential.
  - TSM-15: staging upgrade output must carry the staging NFT.
  - TSM-16: initial staging logic hash must be 28 bytes.
  - TSM-17: initial staging auth hash must be 28 bytes.
  - TSM-18: cnight comparison remains as the compiler touch.
  Operational constraints (info = `Spending`):
  - TS-2: consume the ledger-selected council script input.
  - TS-3: consumed input must be locked by the council script.
  - TS-4: redeemer must decode into `TwoStageRedeemer`.
  - TS-5: record the NFT identity from the spending input.
  - TSM-1: main branch must spend the council main NFT.
  - TSM-2: main branch must reference the staging UTXO named in the redeemer.
  - TSM-3: referenced staging UTXO must be locked by the council script.
  - TSM-4: referenced staging UTXO must hold the staging NFT.
  - TSS-1: staging branch must spend the staging NFT.
  - TSS-2: staging branch must reference the main UTXO locked by the council script.
  - TSS-3: referenced main UTXO must hold the main NFT.
  - TM-1: spending datum must be inline.
  - TM-2: referenced staging datum must be inline.
  - TM-3: spending datum must decode to `UpgradeState`.
  - TM-4: withdrawals must include both auth credentials stored in the main datum.
  - TM-5: staging datum must provide the next logic hash.
  - TM-6: staging datum must provide the next auth hash.
  - TM-7: mitigation logic hash may only transition from empty once.
  - TM-8: staging datum must provide the new mitigation logic hash when set.
  - TM-9: mitigation auth hash may only transition from empty once.
  - TSG-1: redeemer script hash must be 28 bytes.
  - TSG-2: staging datum must be inline.
  - TSG-3: referenced main datum must be inline.
  - TSG-4: staging datum must decode to `UpgradeState`.
  - TSG-5: main datum must decode to `UpgradeState` for comparison.
  - TSG-6: withdrawals must include either the staging auth pair or the main auth pair.
  - TSG-7: staging branch may not set mitigation logic once the main datum holds one.
  - TSG-8: staging branch may not set mitigation auth once the main datum holds one.
  - TS-6: outputs must include a replacement council UTXO locked by the script credential.
  - TS-7: replacement output must carry the same NFT that was spent.
  - TS-8: replacement output must store the evolved state as an inline datum.
  - RUN-1, RUN-2, RUN-3: withdrawal credential checks described above must be satisfied.
  Implementation notes:
  - CT-2: upgrade transactions must reference `config.council_one_shot_{hash,index}` before proceeding.
  - CT-3: the validator delegates all TS/TSM/TSS/TM/TSG/RUN enforcement to `two_stage_upgradable`.
- `council_logic`
  Operational constraints:
  - ML-0: reference inputs must include the council threshold UTXO (`config.main_council_update_threshold_hash`).
  - ML-1: threshold datum must decode to `MultisigThreshold`.
  - ML-2: outputs must keep the council forever state at the script credential.
  - ML-3: mint must contain the native script rebuilt from the technical-authority `Multisig` datum and threshold fraction.
  - ML-4: mint must contain the native script rebuilt from the council `Multisig` datum and threshold fraction.
  - ML-5: redeemer signer map must satisfy MS-1 through MS-4 when validated against the council forever datum.
  - CM-1: inputs or references must expose the council forever NFT.
  - CM-2: council forever datum must be inline.
  - CM-3: council forever datum must decode to `Multisig`.
  - CM-4: mint must contain an asset under the native script derived from that `Multisig` and threshold fraction.
  - GIS-1: every council input consulted via helper lookups must carry exactly one council NFT under the policy and expose inline datum data.
  - GOS-1: council forever output must remain at the script credential.
  - GOS-2: council forever output must carry only that NFT.
  - GOS-3: council forever output must provide inline state.
  - SING-1: no extra assets may accompany the council forever NFT.
  - MS-1: council forever datum must be a `Multisig`.
  - MS-2: redeemer must be a map of signer payloads.
  - MS-3: rebuilding the signer list from the redeemer must succeed.
  - MS-4: reconstructed signer list and total must match the datum.
  Implementation notes:
  - CL-1: the validator captures the transaction, redeemer, and script info before applying quorum checks.
  - CL-2: multisig quorum enforcement is delegated to `logic_multisig_validation_nft_input`, which applies ML-0 through MS-4 plus GIS-1.

## Technical Authority Validators
- `tech_auth_forever`
  Minting / setup constraints:
  - TAF-1: rebuild `config.technical_authority_one_shot_{hash,index}` as the mint authoriser.
  - TAF-2: delegate to `forever_contract`, which enforces FC-1 through FC-9 plus the ILM series for the technical authority.
  - FC-1: consume `config.technical_authority_one_shot_{hash,index}` while minting exactly one technical-authority forever NFT (asset name "") and expose its datum.
  - FC-2: inline datum must satisfy `validate_multisig_structure`.
  - FC-3: touch `config.cnight_policy` to keep the helper in the script hash (no ledger constraint).
  - ILM-1: inputs must spend the technical-authority one-shot UTXO.
  - ILM-2: mint must include the technical-authority policy id.
  - ILM-3: minted assets under that policy must be exactly one technical-authority forever NFT (asset name "").
  - ILM-4: outputs must deliver that NFT to the technical-authority script address with an inline datum.
  Operational constraints:
  - FC-4: reference inputs must include the technical-authority two-stage main NFT (`config.technical_authority_two_stage_hash`, name "main").
  - FC-5: referenced upgrade datum must be inline.
  - FC-6: datum must encode technical-authority main and mitigation logic hashes.
  - FC-7: datum must provide a 28-byte technical-authority main logic hash.
  - FC-8: datum must provide a 28-byte technical-authority mitigation logic hash.
  - FC-9: withdrawals must include credentials for both hashes (RUN tags below).
  - GOS-1: technical-authority forever NFT must remain at the technical-authority script credential.
  - GOS-2: technical-authority forever output must hold only that NFT.
  - GOS-3: technical-authority forever output must provide an inline datum.
  - SING-1: technical-authority forever value must not carry additional assets.
  - RUN-1: withdrawals must include the technical-authority main auth credential.
  - RUN-2: mitigation auth credential may be omitted only when the datum records the empty hash.
  - RUN-3: when the datum records a mitigation auth hash, withdrawals must include that credential.
  - MS-1: technical-authority forever datum must be a `Multisig`.
  - MS-2: technical-authority redeemer must be a map of signer payloads.
  - MS-3: reconstructing the technical-authority signer list from the redeemer must succeed.
  - MS-4: reconstructed technical-authority signer list and total must match the datum.
- `tech_auth_two_stage_upgrade`
  Minting / setup constraints (info = `Minting`):
  - TAU-2: upgrades must also consume `config.technical_authority_one_shot_{hash,index}`.
  - TAU-3: enforcement is delegated to `two_stage_upgradable`, which applies the shared TS/TSM/TSS/TM/TSG/RUN rules for the technical authority.
  - TS-1: mint both technical-authority stage NFTs with inline datums while spending the technical-authority one-shot UTXO.
  - TSM-5: mint must include entries under the technical-authority policy id.
  - TSM-6: minted assets must be exactly one "main" and one "staging" technical-authority upgrade NFT.
  - TSM-7: technical-authority one-shot UTXO must be spent.
  - TSM-8: main upgrade output must pay the technical-authority script with an inline datum.
  - TSM-9: main upgrade output must use the technical-authority script credential.
  - TSM-10: main upgrade output must carry the technical-authority main NFT.
  - TSM-11: initial main logic hash must be 28 bytes.
  - TSM-12: initial main auth hash must be 28 bytes.
  - TSM-13: staging upgrade output must pay the technical-authority script with an inline datum.
  - TSM-14: staging upgrade output must use the technical-authority script credential.
  - TSM-15: staging upgrade output must carry the staging NFT.
  - TSM-16: initial staging logic hash must be 28 bytes.
  - TSM-17: initial staging auth hash must be 28 bytes.
  - TSM-18: comparison with `config.cnight_policy` remains as the compiler touch.
  Operational constraints (info = `Spending`):
  - TS-2: consume the ledger-selected technical-authority script input.
  - TS-3: consumed input must be locked by the technical-authority script.
  - TS-4: redeemer must decode into `TwoStageRedeemer`.
  - TS-5: record the NFT identity from the spending input.
  - TSM-1: main branch must spend the technical-authority main NFT.
  - TSM-2: main branch must reference the staging UTXO named in the redeemer.
  - TSM-3: referenced staging UTXO must be locked by the technical-authority script.
  - TSM-4: referenced staging UTXO must hold the staging NFT.
  - TSS-1: staging branch must spend the staging NFT.
  - TSS-2: staging branch must reference the main UTXO locked by the technical-authority script.
  - TSS-3: referenced main UTXO must hold the main NFT.
  - TM-1: spending datum must be inline.
  - TM-2: referenced staging datum must be inline.
  - TM-3: spending datum must decode to `UpgradeState`.
  - TM-4: withdrawals must include both auth credentials stored in the main datum.
  - TM-5: staging datum must provide the next logic hash.
  - TM-6: staging datum must provide the next auth hash.
  - TM-7: mitigation logic hash may only transition from empty once.
  - TM-8: staging datum must provide the new mitigation logic hash when set.
  - TM-9: mitigation auth hash may only transition from empty once.
  - TSG-1: redeemer script hash must be 28 bytes.
  - TSG-2: staging datum must be inline.
  - TSG-3: referenced main datum must be inline.
  - TSG-4: staging datum must decode to `UpgradeState`.
  - TSG-5: main datum must decode to `UpgradeState` for comparison.
  - TSG-6: withdrawals must include either the staging auth pair or the main auth pair.
  - TSG-7: staging branch may not set mitigation logic once the main datum holds one.
  - TSG-8: staging branch may not set mitigation auth once the main datum holds one.
  - TS-6: outputs must include a replacement technical-authority UTXO locked by the script credential.
  - TS-7: replacement output must carry the same NFT that was spent.
  - TS-8: replacement output must carry the evolved state as an inline datum.
  - RUN-1, RUN-2, RUN-3: withdrawal credential checks described above must be satisfied.
- `tech_auth_logic`
  Operational constraints:
  - ML-0: reference inputs must include the technical-authority threshold UTXO (`config.main_tech_auth_update_threshold_hash`).
  - ML-1: threshold datum must decode to `MultisigThreshold`.
  - ML-2: outputs must keep the technical-authority forever state at the script credential.
  - ML-3: mint must contain the native script rebuilt from the technical-authority `Multisig` datum and threshold fraction.
  - ML-4: mint must also contain the native script rebuilt from the council `Multisig` datum and threshold fraction.
  - ML-5: redeemer signer map must satisfy MS-1 through MS-4 when validated against the technical-authority forever datum.
  - CM-1: inputs or references must expose the technical-authority forever NFT.
  - CM-2: technical-authority forever datum must be inline.
  - CM-3: technical-authority forever datum must decode to `Multisig`.
  - CM-4: mint must contain an asset under the native script derived from that `Multisig` and threshold fraction.
  - GIS-1: every technical-authority input consulted via helper lookups must carry exactly one technical-authority NFT and provide inline datum data.
  - GOS-1: technical-authority forever output must remain at the script credential.
  - GOS-2: technical-authority forever output must carry only that NFT.
  - GOS-3: technical-authority forever output must provide inline state.
  - SING-1: no extra assets may accompany the technical-authority forever NFT.
  - MS-1: technical-authority forever datum must be a `Multisig`.
  - MS-2: redeemer must be a map of signer payloads.
  - MS-3: rebuilding the signer list from the redeemer must succeed.
  - MS-4: reconstructed signer list and total must match the datum.
  Implementation notes:
  - TAL-1: the validator surfaces the transaction, redeemer, and script info to the multisig helper.
  - TAL-2: quorum enforcement delegates to `logic_multisig_validation_nft_input`, which applies ML-0 through MS-4 plus GIS-1.

## Federated Operator Validators
- `federated_ops_forever`
  Minting / setup constraints:
  - FF-1: rebuild `config.federated_operators_one_shot_{hash,index}` as the mint authoriser.
  - FF-2: delegate to `forever_contract`, which enforces FC-1 through FC-9 plus the ILM series for the federated operators.
  - FC-1: consume `config.federated_operators_one_shot_{hash,index}` while minting exactly one federated forever NFT (asset name "") and expose its datum.
  - FC-2: inline datum must satisfy `validate_multisig_structure`.
  - FC-3: touch `config.cnight_policy` to keep the helper in the script hash (no ledger constraint).
  - ILM-1: inputs must spend the federated one-shot UTXO.
  - ILM-2: mint must include the federated policy id.
  - ILM-3: minted assets under that policy must be exactly one federated forever NFT (asset name "").
  - ILM-4: outputs must deliver that NFT to the federated script address with an inline datum.
  Operational constraints:
  - FC-4: reference inputs must include the federated two-stage main NFT (`config.federated_operators_two_stage_hash`, name "main").
  - FC-5: referenced upgrade datum must be inline.
  - FC-6: datum must encode federated main and mitigation logic hashes.
  - FC-7: datum must provide a 28-byte federated main logic hash.
  - FC-8: datum must provide a 28-byte federated mitigation logic hash.
  - FC-9: withdrawals must include credentials for both hashes (RUN tags below).
  - GOS-1: federated forever NFT must remain at the federated script credential.
  - GOS-2: federated forever output must hold only that NFT.
  - GOS-3: federated forever output must provide an inline datum.
  - SING-1: federated forever value must not carry additional assets.
  - RUN-1: withdrawals must include the federated main auth credential.
  - RUN-2: mitigation auth credential may be omitted only when the datum records the empty hash.
  - RUN-3: when the datum records a mitigation auth hash, withdrawals must include that credential.
  - MS-1: federated forever datum must be a `Multisig`.
  - MS-2: federated redeemer must be a map of signer payloads.
  - MS-3: reconstructing the federated signer list from the redeemer must succeed.
  - MS-4: reconstructed federated signer list and total must match the datum.
- `federated_ops_two_stage_upgrade`
  Minting / setup constraints (info = `Minting`):
  - FTU-2: upgrades must consume `config.federated_operators_one_shot_{hash,index}`.
  - FTU-3: enforcement is delegated to `two_stage_upgradable`, which applies the shared TS/TSM/TSS/TM/TSG/RUN rules for the federated operators.
  - TS-1: mint both federated stage NFTs with inline datums while spending the federated one-shot UTXO.
  - TSM-5: mint must include entries under the federated policy id.
  - TSM-6: minted assets must be exactly one "main" and one "staging" federated upgrade NFT.
  - TSM-7: federated one-shot UTXO must be spent.
  - TSM-8: main upgrade output must pay the federated script with an inline datum.
  - TSM-9: main upgrade output must use the federated script credential.
  - TSM-10: main upgrade output must carry the federated main NFT.
  - TSM-11: initial main logic hash must be 28 bytes.
  - TSM-12: initial main auth hash must be 28 bytes.
  - TSM-13: staging upgrade output must pay the federated script with an inline datum.
  - TSM-14: staging upgrade output must use the federated script credential.
  - TSM-15: staging upgrade output must carry the staging NFT.
  - TSM-16: initial staging logic hash must be 28 bytes.
  - TSM-17: initial staging auth hash must be 28 bytes.
  - TSM-18: cnight comparison remains as the compiler touch.
  Operational constraints (info = `Spending`):
  - TS-2: consume the ledger-selected federated script input.
  - TS-3: consumed input must be locked by the federated script.
  - TS-4: redeemer must decode into `TwoStageRedeemer`.
  - TS-5: record the NFT identity from the spending input.
  - TSM-1: main branch must spend the federated main NFT.
  - TSM-2: main branch must reference the staging UTXO named in the redeemer.
  - TSM-3: referenced staging UTXO must be locked by the federated script.
  - TSM-4: referenced staging UTXO must hold the staging NFT.
  - TSS-1: staging branch must spend the staging NFT.
  - TSS-2: staging branch must reference the main UTXO locked by the federated script.
  - TSS-3: referenced main UTXO must hold the main NFT.
  - TM-1: spending datum must be inline.
  - TM-2: referenced staging datum must be inline.
  - TM-3: spending datum must decode to `UpgradeState`.
  - TM-4: withdrawals must include both auth credentials stored in the main datum.
  - TM-5: staging datum must provide the next logic hash.
  - TM-6: staging datum must provide the next auth hash.
  - TM-7: mitigation logic hash may only transition from empty once.
  - TM-8: staging datum must provide the new mitigation logic hash when set.
  - TM-9: mitigation auth hash may only transition from empty once.
  - TSG-1: redeemer script hash must be 28 bytes.
  - TSG-2: staging datum must be inline.
  - TSG-3: referenced main datum must be inline.
  - TSG-4: staging datum must decode to `UpgradeState`.
  - TSG-5: main datum must decode to `UpgradeState` for comparison.
  - TSG-6: withdrawals must include either the staging auth pair or the main auth pair.
  - TSG-7: staging branch may not set mitigation logic once the main datum holds one.
  - TSG-8: staging branch may not set mitigation auth once the main datum holds one.
  - TS-6: outputs must include a replacement federated UTXO locked by the script credential.
  - TS-7: replacement output must carry the same NFT that was spent.
  - TS-8: replacement output must store the evolved state as an inline datum.
  - RUN-1, RUN-2, RUN-3: withdrawal credential checks described above must be satisfied.
- `federated_ops_logic`
  Operational constraints:
  - ML-0: reference inputs must include the federated threshold UTXO (`config.main_federated_ops_update_threshold_hash`).
  - ML-1: threshold datum must decode to `MultisigThreshold`.
  - ML-2: outputs must keep the federated forever state at the script credential.
  - ML-3: mint must contain the native script rebuilt from the technical-authority `Multisig` datum and threshold fraction.
  - ML-4: mint must contain the native script rebuilt from the council `Multisig` datum and threshold fraction.
  - ML-5: redeemer signer map must satisfy MS-1 through MS-4 when validated against the federated forever datum.
  - CM-1: inputs or references must expose the federated forever NFT.
  - CM-2: federated forever datum must be inline.
  - CM-3: federated forever datum must decode to `Multisig`.
  - CM-4: mint must contain an asset under the native script derived from that `Multisig` and threshold fraction.
  - GIS-1: every federated input consulted via helper lookups must carry exactly one federated NFT and provide inline datum data.
  - GOS-1: federated forever output must remain at the script credential.
  - GOS-2: federated forever output must carry only that NFT.
  - GOS-3: federated forever output must provide inline state.
  - SING-1: no extra assets may accompany the federated forever NFT.
  - MS-1: federated forever datum must be a `Multisig`.
  - MS-2: redeemer must be a map of signer payloads.
  - MS-3: rebuilding the signer list from the redeemer must succeed.
  - MS-4: reconstructed signer list and total must match the datum.
  Implementation notes:
  - FL-1: the validator exposes the transaction, redeemer, and script info to the multisig helper.
  - FL-2: quorum enforcement delegates to `logic_multisig_validation_nft_input`, which applies ML-0 through MS-4 plus GIS-1.


## Governance Threshold Validators
- `main_gov_threshold`
  Minting / setup constraints:
  - THM-1: spend `config.main_gov_one_shot_{hash,index}` while capturing the inline threshold datum during minting.
  - THM-2: minted datum must decode to `MultisigThreshold`.
  - THM-3: touch `config.cnight_policy` so the helper logic remains in the script hash.
  Spending / operational constraints:
  - THS-1: locate the ledger-selected main governance threshold input.
  - THS-2: consume an input locked by the threshold script credential.
  - THS-3: reconstruct the expected threshold NFT identity for comparison.
  - THS-4: record the NFT pair present on the spending input.
  - THS-5: require the input NFT pair to match the reconstructed identity.
  - THS-6: spending datum must be provided inline.
  - THS-7: spending datum must decode to `MultisigThreshold`.
  - THS-8: mint must include the technical-authority native script rebuilt from the datum and threshold fraction.
  - THS-9: mint must include the council native script rebuilt from the datum and threshold fraction.
  - THS-10: inspect the first output as the replacement threshold state.
  - THS-11: capture the NFT pair written to the replacement output.
  - THS-12: replacement datum must be provided inline.
  - THS-13: replacement output must retain the threshold script credential.
  - THS-14: replacement output must carry the exact same threshold NFT.
  - THS-15: replacement datum must satisfy `validation`.
  - THD-1: replacement datum must decode to `MultisigThreshold`.
  - THD-2: replacement technical-authority numerator must be strictly less than its denominator.
  - THD-3: replacement council numerator must be strictly less than its denominator.
  - THD-4: replacement technical-authority numerator must be strictly positive.
  - THD-5: replacement council numerator must be strictly positive.
- `staging_gov_threshold`
  Minting / setup constraints:
  - THM-1: spend `config.staging_gov_one_shot_{hash,index}` while capturing the inline threshold datum during minting.
  - THM-2: minted datum must satisfy `validation`.
  - THM-3: touch `config.cnight_policy` so the helper logic remains in the script hash.
  - THD-1: minted datum must decode to `MultisigThreshold`.
  - THD-2: minted technical-authority numerator must be strictly less than its denominator.
  - THD-3: minted council numerator must be strictly less than its denominator.
  - THD-4: minted technical-authority numerator must be strictly positive.
  - THD-5: minted council numerator must be strictly positive.
  Spending / operational constraints:
  - THS-1: locate the ledger-selected staging threshold input.
  - THS-2: consume an input locked by the threshold script credential.
  - THS-5: the spending input must expose exactly one threshold NFT.
  - THS-7: reference datum must decode to `MultisigThreshold`.
  - THS-8: mint must include the technical-authority native script rebuilt from the datum and threshold fraction.
  - THS-9: mint must include the council native script rebuilt from the datum and threshold fraction.
  - THS-10: inspect the first output as the replacement threshold state.
  - THS-12: replacement datum must be provided inline.
  - THS-13: replacement output must retain the threshold script credential.
  - THS-14: replacement output must carry exactly one threshold NFT.
  - THS-15: replacement datum must satisfy `validation`.
  - THS-16: reference inputs must expose the main governance threshold state as an inline datum.
  - THD-1: replacement datum must decode to `MultisigThreshold`.
  - THD-2: replacement technical-authority numerator must be strictly less than its denominator.
  - THD-3: replacement council numerator must be strictly less than its denominator.
  - THD-4: replacement technical-authority numerator must be strictly positive.
  - THD-5: replacement council numerator must be strictly positive.
  Implementation notes:
  - SGT-1: enforcement is delegated to `threshold_validation`.
- `main_council_update_threshold`
  Minting / setup constraints:
  - THM-1: spend `config.main_council_update_one_shot_{hash,index}` while capturing the inline threshold datum during minting.
  - THM-2: minted datum must satisfy `validation`.
  - THM-3: touch `config.cnight_policy` so the helper logic remains in the script hash.
  - THD-1: minted datum must decode to `MultisigThreshold`.
  - THD-2: minted technical-authority numerator must be strictly less than its denominator.
  - THD-3: minted council numerator must be strictly less than its denominator.
  - THD-4: minted technical-authority numerator must be strictly positive.
  - THD-5: minted council numerator must be strictly positive.
  Spending / operational constraints:
  - THS-1: locate the ledger-selected council update threshold input.
  - THS-2: consume an input locked by the threshold script credential.
  - THS-5: the spending input must expose exactly one threshold NFT.
  - THS-7: reference datum must decode to `MultisigThreshold`.
  - THS-8: mint must include the technical-authority native script rebuilt from the datum and threshold fraction.
  - THS-9: mint must include the council native script rebuilt from the datum and threshold fraction.
  - THS-10: inspect the first output as the replacement threshold state.
  - THS-12: replacement datum must be provided inline.
  - THS-13: replacement output must retain the threshold script credential.
  - THS-14: replacement output must carry exactly one threshold NFT.
  - THS-15: replacement datum must satisfy `validation`.
  - THS-16: reference inputs must expose the main governance threshold state as an inline datum.
  - THD-1: replacement datum must decode to `MultisigThreshold`.
  - THD-2: replacement technical-authority numerator must be strictly less than its denominator.
  - THD-3: replacement council numerator must be strictly less than its denominator.
  - THD-4: replacement technical-authority numerator must be strictly positive.
  - THD-5: replacement council numerator must be strictly positive.
  Implementation notes:
  - CGT-1: enforcement is delegated to `threshold_validation`.
- `main_tech_auth_update_threshold`
  Minting / setup constraints:
  - THM-1: spend `config.main_tech_auth_update_one_shot_{hash,index}` while capturing the inline threshold datum during minting.
  - THM-2: minted datum must satisfy `validation`.
  - THM-3: touch `config.cnight_policy` so the helper logic remains in the script hash.
  - THD-1: minted datum must decode to `MultisigThreshold`.
  - THD-2: minted technical-authority numerator must be strictly less than its denominator.
  - THD-3: minted council numerator must be strictly less than its denominator.
  - THD-4: minted technical-authority numerator must be strictly positive.
  - THD-5: minted council numerator must be strictly positive.
  Spending / operational constraints:
  - THS-1: locate the ledger-selected technical-authority update threshold input.
  - THS-2: consume an input locked by the threshold script credential.
  - THS-5: the spending input must expose exactly one threshold NFT.
  - THS-7: reference datum must decode to `MultisigThreshold`.
  - THS-8: mint must include the technical-authority native script rebuilt from the datum and threshold fraction.
  - THS-9: mint must include the council native script rebuilt from the datum and threshold fraction.
  - THS-10: inspect the first output as the replacement threshold state.
  - THS-12: replacement datum must be provided inline.
  - THS-13: replacement output must retain the threshold script credential.
  - THS-14: replacement output must carry exactly one threshold NFT.
  - THS-15: replacement datum must satisfy `validation`.
  - THS-16: reference inputs must expose the main governance threshold state as an inline datum.
  - THD-1: replacement datum must decode to `MultisigThreshold`.
  - THD-2: replacement technical-authority numerator must be strictly less than its denominator.
  - THD-3: replacement council numerator must be strictly less than its denominator.
  - THD-4: replacement technical-authority numerator must be strictly positive.
  - THD-5: replacement council numerator must be strictly positive.
  Implementation notes:
  - TAT-1: enforcement is delegated to `threshold_validation`.
- `main_federated_ops_update_threshold`
  Minting / setup constraints:
  - THM-1: spend `config.main_federated_ops_update_one_shot_{hash,index}` while capturing the inline threshold datum during minting.
  - THM-2: minted datum must satisfy `validation`.
  - THM-3: touch `config.cnight_policy` so the helper logic remains in the script hash.
  - THD-1: minted datum must decode to `MultisigThreshold`.
  - THD-2: minted technical-authority numerator must be strictly less than its denominator.
  - THD-3: minted council numerator must be strictly less than its denominator.
  - THD-4: minted technical-authority numerator must be strictly positive.
  - THD-5: minted council numerator must be strictly positive.
  Spending / operational constraints:
  - THS-1: locate the ledger-selected federated-operator update threshold input.
  - THS-2: consume an input locked by the threshold script credential.
  - THS-5: the spending input must expose exactly one threshold NFT.
  - THS-7: reference datum must decode to `MultisigThreshold`.
  - THS-8: mint must include the technical-authority native script rebuilt from the datum and threshold fraction.
  - THS-9: mint must include the council native script rebuilt from the datum and threshold fraction.
  - THS-10: inspect the first output as the replacement threshold state.
  - THS-12: replacement datum must be provided inline.
  - THS-13: replacement output must retain the threshold script credential.
  - THS-14: replacement output must carry exactly one threshold NFT.
  - THS-15: replacement datum must satisfy `validation`.
  - THS-16: reference inputs must expose the main governance threshold state as an inline datum.
  - THD-1: replacement datum must decode to `MultisigThreshold`.
  - THD-2: replacement technical-authority numerator must be strictly less than its denominator.
  - THD-3: replacement council numerator must be strictly less than its denominator.
  - THD-4: replacement technical-authority numerator must be strictly positive.
  - THD-5: replacement council numerator must be strictly positive.
  Implementation notes:
  - FOT-1: enforcement is delegated to `threshold_validation`.
- `beefy_signer_threshold`
  Minting / setup constraints:
  - THM-1: spend `config.committee_threshold_one_shot_{hash,index}` while capturing the inline beefy threshold datum during minting.
  - THM-2: minted datum must satisfy `validation`.
  - THM-3: touch `config.cnight_policy` so the helper logic remains in the script hash.
  - THD-1: minted datum must decode to `MultisigThreshold`.
  - THD-2: minted technical-authority numerator must be strictly less than its denominator.
  - THD-3: minted council numerator must be strictly less than its denominator.
  - THD-4: minted technical-authority numerator must be strictly positive.
  - THD-5: minted council numerator must be strictly positive.
  Spending / operational constraints:
  - THS-1: locate the ledger-selected beefy signer threshold input.
  - THS-2: consume an input locked by the beefy threshold script credential.
  - THS-5: the spending input must expose exactly one beefy threshold NFT.
  - THS-7: reference datum must decode to `MultisigThreshold`.
  - THS-8: mint must include the technical-authority native script rebuilt from the datum and threshold fraction.
  - THS-9: mint must include the council native script rebuilt from the datum and threshold fraction.
  - THS-10: inspect the first output as the replacement threshold state.
  - THS-12: replacement datum must be provided inline.
  - THS-13: replacement output must retain the threshold script credential.
  - THS-14: replacement output must carry exactly one beefy threshold NFT.
  - THS-15: replacement datum must satisfy `validation`.
  - THS-16: reference inputs must expose the main governance threshold state as an inline datum.
  - THD-1: replacement datum must decode to `MultisigThreshold`.
  - THD-2: replacement technical-authority numerator must be strictly less than its denominator.
  - THD-3: replacement council numerator must be strictly less than its denominator.
  - THD-4: replacement technical-authority numerator must be strictly positive.
  - THD-5: replacement council numerator must be strictly positive.
  Implementation notes:
  - BST-1: enforcement is delegated to `threshold_validation`.

## Governance Auth Validators
- `main_gov_auth`
  Operational constraints:
  - GA-2: reference inputs must expose the main governance threshold state as an inline datum.
  - GA-3: threshold datum must decode to `MultisigThreshold`.
  - GA-4: mint must include the native script rebuilt from the technical-authority datum and threshold fraction.
  - GA-5: mint must include the native script rebuilt from the council datum and threshold fraction.
  - GA-6: withdrawals and credential revocations must satisfy the multisig checks above.
  - GA-7: registration operations must touch `config.cnight_policy` to retain the helper in the script hash.
  Implementation notes:
  - GAV-1: the validator delegates to `auth_multisig_validation`.
- `staging_gov_auth`
  Operational constraints:
  - GAS-1: determine whether council logic currently runs on main when selecting the threshold state.
  - LIM-1: locate the main upgrade UTXO locked by `config.council_two_stage_hash`.
  - LIM-2: main upgrade datum must be provided inline.
  - LIM-3: extract the recorded logic hash from that datum.
  - LIM-4: ensure the recorded logic hash matches the script hash under validation.
  - GAS-2: threshold datum must decode to `MultisigThreshold`.
  - GAS-3: mint must include the native script rebuilt from the technical-authority datum and threshold fraction.
  - GAS-4: mint must include the native script rebuilt from the council datum and threshold fraction.
  - GAS-6: withdrawals and credential revocations must satisfy the multisig checks above.
  - GAS-5: registration operations must touch `config.cnight_policy` to retain the helper in the script hash.
  Implementation notes:
  - GAVS-1: the validator delegates to `staging_auth_multisig_validation`.

## illiquid Circulation Supply Validators
- `ics_forever`
  Minting / setup constraints:
  - IF-1: rebuild `config.ics_one_shot_{hash,index}` as the one-shot reference for minting.
  - FC-1: consume the illiq one-shot UTXO while minting exactly one forever NFT (asset name "") and expose its datum.
  - FC-2: inline datum must satisfy `ics_init_validation`.
  - ICS-1: `ics_init_validation` imposes no additional checks beyond the forever helper.
  - FC-3: touch `config.cnight_policy` to retain the helper in the script hash.
  - ILM-1: inputs must spend the illiq one-shot UTXO.
  - ILM-2: mint must include the illiq policy id.
  - ILM-3: minted assets under that policy must be exactly one NFT named "".
  - ILM-4: outputs must deliver that NFT to the illiq script address with an inline datum.
  Spending / operational constraints:
  - FC-4: reference inputs must include the illiq two-stage main NFT (`config.ics_two_stage_hash`, name "main").
  - FC-5: referenced upgrade datum must be inline.
  - FC-6: datum must encode illiq main and mitigation logic hashes.
  - FC-7: datum must provide a 28-byte illiq main logic hash.
  - FC-8: datum must provide a 28-byte illiq mitigation logic hash.
  - FC-9: withdrawals must include credentials for both hashes (RUN tags below).
  - GOS-1: outputs must pay the illiq forever NFT to the illiq script credential.
  - GOS-2: illiq forever output must hold only that NFT.
  - GOS-3: illiq forever output must provide an inline datum.
  - SING-1: illiq forever value must not carry additional assets.
  - RUN-1: withdrawals must include the credential recorded as the main auth hash.
  - RUN-2: mitigation auth credential may be omitted only when the datum records the empty hash.
  - RUN-3: when the datum records a mitigation auth hash, withdrawals must include that credential.
  Implementation notes:
  - IF-2: minting and spending rules are enforced by `forever_contract`.
- `ics_two_stage_upgrade`
  Minting / setup constraints (info = `Minting`):
  - IU-1: rebuild `config.ics_one_shot_{hash,index}` as the one-shot reference for minting.
  - TS-1: mint both illiq stage NFTs with inline datums while spending the illiq one-shot UTXO.
  - TSM-5: mint must include entries under the illiq policy id.
  - TSM-6: minted assets must be exactly one "main" and one "staging" illiq upgrade NFT.
  - TSM-7: illiq one-shot UTXO must be spent.
  - TSM-8: main upgrade output must pay the illiq script with an inline datum.
  - TSM-9: main upgrade output must use the illiq script credential.
  - TSM-10: main upgrade output must carry the illiq main NFT.
  - TSM-11: initial main logic hash must be 28 bytes.
  - TSM-12: initial main auth hash must be 28 bytes.
  - TSM-13: staging upgrade output must pay the illiq script with an inline datum.
  - TSM-14: staging upgrade output must use the illiq script credential.
  - TSM-15: staging upgrade output must carry the staging NFT.
  - TSM-16: initial staging logic hash must be 28 bytes.
  - TSM-17: initial staging auth hash must be 28 bytes.
  - TSM-18: cnight comparison remains as the compiler touch.
  Spending / operational constraints (info = `Spending`):
  - TS-2: consume the ledger-selected illiq script input.
  - TS-3: consumed input must be locked by the illiq script.
  - TS-4: redeemer must decode into `TwoStageRedeemer`.
  - TS-5: record the NFT identity from the spending input.
  - TSM-1: main branch must spend the illiq main NFT.
  - TSM-2: main branch must reference the staging UTXO named in the redeemer.
  - TSM-3: referenced staging UTXO must be locked by the illiq script.
  - TSM-4: referenced staging UTXO must hold the staging NFT.
  - TSS-1: staging branch must spend the staging NFT.
  - TSS-2: staging branch must reference the main UTXO locked by the illiq script.
  - TSS-3: referenced main UTXO must hold the main NFT.
  - TM-1: spending datum must be inline.
  - TM-2: referenced staging datum must be inline.
  - TM-3: spending datum must decode to `UpgradeState`.
  - TM-4: withdrawals must include both auth credentials stored in the main datum.
  - TM-5: staging datum must provide the next logic hash.
  - TM-6: staging datum must provide the next auth hash.
  - TM-7: mitigation logic hash may only transition from empty once.
  - TM-8: staging datum must provide the new mitigation logic hash when set.
  - TM-9: mitigation auth hash may only transition from empty once.
  - TSG-1: redeemer script hash must be 28 bytes.
  - TSG-2: staging datum must be inline.
  - TSG-3: referenced main datum must be inline.
  - TSG-4: staging datum must decode to `UpgradeState`.
  - TSG-5: main datum must decode to `UpgradeState` for comparison.
  - TSG-6: withdrawals must include either the staging auth pair or the main auth pair.
  - TSG-7: staging branch may not set mitigation logic once the main datum holds one.
  - TSG-8: staging branch may not set mitigation auth once the main datum holds one.
  - TS-6: outputs must include a replacement illiq UTXO locked by the script credential.
  - TS-7: replacement output must carry the same NFT that was spent.
  - TS-8: replacement output must store the evolved state as an inline datum.
  - RUN-1, RUN-2, RUN-3: withdrawal credential checks described above must be satisfied.
  Implementation notes:
  - IU-2: minting and spending rules are enforced by `two_stage_upgradable`.
- `ics_logic`
  Operational constraints:
  - IL-1: delegate to `logic_merge` using `config.ics_forever_hash`.
  - LM-0: transaction must create an output locked by the illiq script credential.
  - LM-1: sum every input guarded by the illiq credential to determine the required post-merge balance.
  - LM-2: replacement illiq output must carry inline datum data (datum hashes are rejected).
  - LM-3: illiq logic must never consume the illiq forever NFT while merging values.
  - LM-4: replacement illiq output must return at least the aggregated ADA and NIGHT balances under the illiq policy.

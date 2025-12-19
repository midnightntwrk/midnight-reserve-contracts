use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use config
use forever/script.{forever_contract} as ft
use forever/types.{TermsAndConditions, Versioned}
use logic/script.{logic_multisig_validation_nft_input}
use upgradable/two_stage_upgrade.{two_stage_upgradable}

fn validate_terms_structure(datum: Data, _redeemer) {
  // (MS-1) Assert the datum encodes a Multisig value so signer lists are well typed.
  expect Versioned { data: TermsAndConditions { hash, .. }, logic_round: 0 }: Versioned<
    TermsAndConditions,
  > = datum

  builtin.length_of_bytearray(hash) == 32
}

validator terms_and_conditions_forever {
  else(ctx: ScriptContext) {
    // (FF-1) Locate the federated operators one-shot reference required to initialise or mint the forever state.
    let one_shot_ref =
      OutputReference(
        config.terms_and_conditions_one_shot_hash,
        config.terms_and_conditions_one_shot_index,
      )

    // (FF-2) Delegate to the forever helper (FC-1, FC-2, FC-3, FC-4, FC-5, FC-6, FC-7, FC-8, FC-9).
    forever_contract(
      ctx,
      one_shot_ref,
      config.terms_and_conditions_two_stage_hash,
      validate_terms_structure,
    )
  }
}

validator terms_and_conditions_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    // (FTU-2) Reference the federated operators one-shot UTXO which must be spent to authorise upgrades.
    let one_shot_ref =
      OutputReference(
        config.terms_and_conditions_one_shot_hash,
        config.terms_and_conditions_one_shot_index,
      )

    // (FTU-3) Apply the shared two-stage checks (TS-1, TS-2, TS-3, TS-4, TS-5, TS-6, TS-7, TS-8,
    //        TSM-1, TSM-2, TSM-3, TSM-4, TSM-5, TSM-6, TSM-7, TSM-8, TSM-9, TSM-10, TSM-11, TSM-12,
    //        TSM-13, TSM-14, TSM-15, TSM-16, TSM-17, TSM-18, TSS-1, TSS-2, TSS-3, TM-1, TM-2, TM-3,
    //        TM-4, TM-5, TM-6, TM-7, TM-8, TSG-1, TSG-2, TSG-3, TSG-4, TSG-5, TSG-6, TSG-7, TSG-8,
    //        RUN-1, RUN-2, RUN-3).
    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator terms_and_conditions_logic {
  else(ctx: ScriptContext) {
    // (TCL-1) Gather the transaction data required to verify terms and conditions updates.
    let ScriptContext { transaction, redeemer, info } = ctx

    // (TCL-2) Enforce terms and conditions via the logic helper (ML-0, ML-1, ML-2, ML-3, ML-4, ML-5,
    //        CM-1, CM-2, CM-3, CM-4, GOS-1, GOS-2, GOS-3, GIS-1, SING-1, MS-1, MS-2, MS-3, MS-4);
    //        RegisterCredential stays open.
    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.terms_and_conditions_forever_hash,
      validate_terms_structure,
      config.terms_and_conditions_threshold_hash,
    )
  }
}

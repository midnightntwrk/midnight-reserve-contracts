use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use forever/types.{TermsAndConditions, Versioned}
use logic/script.{logic_multisig_validation_nft_input} as logic_script
use multisig/script.{create_signer} as multisig_script
use multisig/types.{Multisig} as multisig_types
use upgradable/two_stage_upgrade.{two_stage_upgradable}
use utils.{foldr2}

fn validate_multisig_structure(datum: Data, redeemer: Redeemer) {
  // (MS-1) Assert the datum encodes a Multisig value so signer lists are well typed.
  expect Versioned { data: Multisig { total_signers, signers }, round: 0 }: Versioned<
    Multisig,
  > = datum

  // (MS-2) Convert the redeemer payload into the signer map supplied for this transaction.
  let given_signers = redeemer |> builtin.un_map_data

  // (MS-3) Fold the redeemer entries to rebuild the canonical signer list and its length.
  let
    expected_signers,
    len,
  <-
    foldr2(
      given_signers,
      [],
      0,
      fn(signer, acc_signers, len, return) {
        return(
          [
            Pair(signer.1st |> builtin.un_b_data |> create_signer, signer.2nd),
            ..acc_signers
          ],
          len + 1,
        )
      },
    )

  // (MS-4) Require the reconstructed signers and declared cardinality to match the datum exactly.
  and {
    as_data(expected_signers) == signers,
    total_signers == len,
  }
}

fn validate_terms_structure(datum: Data, _redeemer) {
  // (MS-1) Assert the datum encodes a Multisig value so signer lists are well typed.
  expect Versioned { data: TermsAndConditions { hash, .. }, round: 0 }: Versioned<
    TermsAndConditions,
  > = datum

  builtin.length_of_bytearray(hash) == 32
}

validator council_forever {
  else(ctx: ScriptContext) {
    // (CF-1) Select the configured council one-shot reference that must be consumed when minting.
    let one_shot_ref =
      OutputReference(
        config.council_one_shot_hash,
        config.council_one_shot_index,
      )

    // (CF-2) Delegate to the forever helper (FC-1, FC-2, FC-3, FC-4, FC-5, FC-6, FC-7, FC-8, FC-9).
    forever_contract(
      ctx,
      one_shot_ref,
      config.council_two_stage_hash,
      validate_multisig_structure,
    )
  }
}

validator council_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    // (CT-2) Reconstruct the council one-shot reference; upgrades are only permitted when this UTXO is spent.
    let one_shot_ref =
      OutputReference(
        config.council_one_shot_hash,
        config.council_one_shot_index,
      )

    // (CT-3) Apply the shared two-stage checks (TS-1, TS-2, TS-3, TS-4, TS-5, TS-6, TS-7, TS-8,
    //        TSM-1, TSM-2, TSM-3, TSM-4, TSM-5, TSM-6, TSM-7, TSM-8, TSM-9, TSM-10, TSM-11, TSM-12,
    //        TSM-13, TSM-14, TSM-15, TSM-16, TSM-17, TSM-18, TSS-1, TSS-2, TSS-3, TM-1, TM-2, TM-3,
    //        TM-4, TM-5, TM-6, TM-7, TM-8, TSG-1, TSG-2, TSG-3, TSG-4, TSG-5, TSG-6, TSG-7, TSG-8,
    //        RUN-1, RUN-2, RUN-3).
    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator council_logic {
  else(ctx: ScriptContext) {
    // (CL-1) Capture the transaction, redeemer, and script info used to evaluate quorum rules.
    let ScriptContext { transaction, redeemer, info } = ctx

    // (CL-2) Enforce council multisig via the logic helper (ML-0, ML-1, ML-2, ML-3, ML-4, ML-5,
    //        CM-1, CM-2, CM-3, CM-4, GOS-1, GOS-2, GOS-3, GIS-1, SING-1, MS-1, MS-2, MS-3, MS-4);
    //        RegisterCredential stays open.
    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.council_forever_hash,
      validate_multisig_structure,
      config.main_council_update_threshold_hash,
    )
  }
}

validator tech_auth_forever {
  else(ctx: ScriptContext) {
    // (TAF-1) Identify the technical authority one-shot reference that must back the minting transaction.
    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    // (TAF-2) Delegate to the forever helper (FC-1, FC-2, FC-3, FC-4, FC-5, FC-6, FC-7, FC-8, FC-9).
    forever_contract(
      ctx,
      one_shot_ref,
      config.technical_authority_two_stage_hash,
      validate_multisig_structure,
    )
  }
}

validator tech_auth_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    // (TAU-2) Recreate the technical authority one-shot reference which must be consumed for any upgrade path.
    let one_shot_ref =
      OutputReference(
        config.technical_authority_one_shot_hash,
        config.technical_authority_one_shot_index,
      )

    // (TAU-3) Apply the shared two-stage checks (TS-1, TS-2, TS-3, TS-4, TS-5, TS-6, TS-7, TS-8,
    //        TSM-1, TSM-2, TSM-3, TSM-4, TSM-5, TSM-6, TSM-7, TSM-8, TSM-9, TSM-10, TSM-11, TSM-12,
    //        TSM-13, TSM-14, TSM-15, TSM-16, TSM-17, TSM-18, TSS-1, TSS-2, TSS-3, TM-1, TM-2, TM-3,
    //        TM-4, TM-5, TM-6, TM-7, TM-8, TSG-1, TSG-2, TSG-3, TSG-4, TSG-5, TSG-6, TSG-7, TSG-8,
    //        RUN-1, RUN-2, RUN-3).
    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator tech_auth_logic {
  else(ctx: ScriptContext) {
    // (TAL-1) Expose the transaction context that will feed multisig quorum evaluation for technical authority actions.
    let ScriptContext { transaction, redeemer, info } = ctx

    // (TAL-2) Enforce technical-authority multisig via the logic helper (ML-0, ML-1, ML-2, ML-3,
    //        ML-4, ML-5, CM-1, CM-2, CM-3, CM-4, GOS-1, GOS-2, GOS-3, GIS-1, SING-1, MS-1, MS-2,
    //        MS-3, MS-4); RegisterCredential stays open.
    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.technical_authority_forever_hash,
      validate_multisig_structure,
      config.main_tech_auth_update_threshold_hash,
    )
  }
}

validator federated_ops_forever {
  else(ctx: ScriptContext) {
    // (FF-1) Locate the federated operators one-shot reference required to initialise or mint the forever state.
    let one_shot_ref =
      OutputReference(
        config.federated_operators_one_shot_hash,
        config.federated_operators_one_shot_index,
      )

    // (FF-2) Delegate to the forever helper (FC-1, FC-2, FC-3, FC-4, FC-5, FC-6, FC-7, FC-8, FC-9).
    forever_contract(
      ctx,
      one_shot_ref,
      config.federated_operators_two_stage_hash,
      validate_multisig_structure,
    )
  }
}

validator federated_ops_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    // (FTU-2) Reference the federated operators one-shot UTXO which must be spent to authorise upgrades.
    let one_shot_ref =
      OutputReference(
        config.federated_operators_one_shot_hash,
        config.federated_operators_one_shot_index,
      )

    // (FTU-3) Apply the shared two-stage checks (TS-1, TS-2, TS-3, TS-4, TS-5, TS-6, TS-7, TS-8,
    //        TSM-1, TSM-2, TSM-3, TSM-4, TSM-5, TSM-6, TSM-7, TSM-8, TSM-9, TSM-10, TSM-11, TSM-12,
    //        TSM-13, TSM-14, TSM-15, TSM-16, TSM-17, TSM-18, TSS-1, TSS-2, TSS-3, TM-1, TM-2, TM-3,
    //        TM-4, TM-5, TM-6, TM-7, TM-8, TSG-1, TSG-2, TSG-3, TSG-4, TSG-5, TSG-6, TSG-7, TSG-8,
    //        RUN-1, RUN-2, RUN-3).
    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator federated_ops_logic {
  else(ctx: ScriptContext) {
    // (FL-1) Gather the transaction data required to verify federated operator multisig participation.
    let ScriptContext { transaction, redeemer, info } = ctx

    // (FL-2) Enforce federated multisig via the logic helper (ML-0, ML-1, ML-2, ML-3, ML-4, ML-5,
    //        CM-1, CM-2, CM-3, CM-4, GOS-1, GOS-2, GOS-3, GIS-1, SING-1, MS-1, MS-2, MS-3, MS-4);
    //        RegisterCredential stays open.
    logic_multisig_validation_nft_input(
      transaction,
      redeemer,
      info,
      config.federated_operators_forever_hash,
      validate_multisig_structure,
      config.main_federated_ops_update_threshold_hash,
    )
  }
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

use aiken/builtin
use aiken/crypto.{ScriptHash}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptContext, ScriptInfo, Withdrawing}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}
use config
use multisig/script.{check_for_multisig}
use multisig/types.{MultisigThreshold}
use upgradable/two_stage_upgrade.{two_stage_upgradable, validate_running}
use utils.{get_input_state_by_policy, is_singleton, must_find}

pub fn forever_mint_contract(ctx: ScriptContext, two_stage_hash: ScriptHash) {
  let ScriptContext {
    transaction: Transaction { reference_inputs, withdrawals, .. },
    ..
  } = ctx

  // (FC-4) Require a reference input that holds exactly one `main` NFT under the two-stage script.
  let input =
    reference_inputs
      |> must_find(
          fn(input) { is_singleton(input.output.value, two_stage_hash, "main") },
        )

  let main_state = input.output.datum

  // (FC-5) Ensure the reference datum is provided inline.
  expect InlineDatum(main_state) = main_state

  // (FC-6) Require the datum layout to begin with main and mitigation logic hashes.
  expect [logic, mitigation_logic, ..] = main_state |> builtin.un_list_data

  // (FC-7) Extract the recorded main logic script hash.
  let logic = logic |> builtin.un_b_data

  // (FC-8) Extract the recorded mitigation logic script hash.
  let mitigation_logic = mitigation_logic |> builtin.un_b_data

  // (FC-9) Require both recorded scripts to appear in withdrawals before allowing the spend.
  validate_running(logic, mitigation_logic, withdrawals)
}

/// This set of validators is purely for testnet no audit is necessary.
/// Real funds are not used via this contract
validator tcnight_forever {
  else(ctx: ScriptContext) {
    // (FF-2) Delegate to the forever helper (FC-1, FC-2, FC-3, FC-4, FC-5, FC-6, FC-7, FC-8, FC-9).
    forever_mint_contract(ctx, config.terms_and_conditions_two_stage_hash)
  }
}

validator tcnight_two_stage_upgrade {
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

pub fn logic_multisig_validation(
  transaction: Transaction,
  info: ScriptInfo,
  main_threshold: ScriptHash,
) {
  let Transaction { reference_inputs, mint, .. } = transaction

  let validation =
    fn() {
      // (ML-0) Fetch the threshold state referenced by `main_threshold`.
      let threshold_datum =
        get_input_state_by_policy(reference_inputs, main_threshold)

      // (ML-1) Decode the threshold datum to recover the configured fractions.
      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      }: MultisigThreshold = threshold_datum

      and {
        // (ML-3) Ensure the technical-authority native script built from the datum and threshold appears in the mint field.
        check_for_multisig(
          // Used in the case we are spending multisig state rather than referencing it
          reference_inputs,
          mint,
          config.technical_authority_forever_hash,
          technical_auth_numerator,
          technical_auth_denominator,
        ),
        // (ML-4) Ensure the council native script built from the datum and threshold appears in the mint field.
        check_for_multisig(
          // Used in the case we are spending multisig state rather than referencing it
          reference_inputs,
          mint,
          config.council_forever_hash,
          council_numerator,
          council_denominator,
        ),
      }
    }

  when info is {
    Withdrawing(_) | Publishing { certificate: UnregisterCredential { .. }, .. } ->
      validation()

    Publishing { certificate: RegisterCredential { .. }, .. } -> True

    _ -> fail
  }
}

validator tcnight_logic {
  else(ctx: ScriptContext) {
    // (FL-1) Gather the transaction data required to verify federated operator multisig participation.
    let ScriptContext { transaction, info, .. } = ctx

    // (FL-2) Enforce federated multisig via the logic helper (ML-0, ML-1, ML-2, ML-3, ML-4, ML-5,
    //        CM-1, CM-2, CM-3, CM-4, GOS-1, GOS-2, GOS-3, GIS-1, SING-1, MS-1, MS-2, MS-3, MS-4);
    //        RegisterCredential stays open.
    logic_multisig_validation(transaction, info, config.main_gov_threshold_hash)
  }
}

use cardano/address.{Script}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{Transaction}
use config
use multisig/script.{check_for_multisig}
use multisig/types.{MultisigThreshold}
use utils.{get_input_state_by_policy}

pub fn auth_multisig_validation(transaction: Transaction, info: ScriptInfo) {
  let Transaction { reference_inputs, mint, .. } = transaction

  let validation =
    fn() {
      // (GA-2) Require the transaction to reference the main governance threshold state with an inline datum.
      let threshold_datum =
        get_input_state_by_policy(
          reference_inputs,
          config.main_gov_threshold_hash,
        )

      // (GA-3) Decode the threshold datum into its numerator/denominator fields.
      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      } = threshold_datum

      and {
        // (GA-4) Require the technical-authority native script derived from the datum to appear in the mint field.
        check_for_multisig(
          reference_inputs,
          mint,
          config.technical_authority_forever_hash,
          technical_auth_numerator,
          technical_auth_denominator,
        ),
        // (GA-5) Require the council native script derived from the datum to appear in the mint field.
        check_for_multisig(
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
      // (GA-6) For withdrawals and credential revocations enforce the multisig checks above.
      validation()

    Publishing {
      certificate: RegisterCredential { credential: Script(own_hash), .. },
      ..
    } ->
      // (GA-7) Touch `cnight_policy` so it contributes to the script hash; the inequality is only to stop the optimizer removing it.
      config.cnight_policy != own_hash

    _ -> fail
  }
}

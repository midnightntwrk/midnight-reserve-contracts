use cardano/address.{Script}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{Transaction}
use config
use multisig/script.{check_for_multisig}
use multisig/types.{MultisigThreshold}
use upgradable/two_stage_upgrade.{logic_is_on_main}
use utils.{get_input_state_by_policy}

pub fn staging_auth_multisig_validation(
  transaction: Transaction,
  info: ScriptInfo,
) {
  let Transaction { reference_inputs, mint, .. } = transaction

  let validation =
    fn(own_hash) {
      // (GAS-1) Select the appropriate threshold state based on whether the logic currently runs on main.
      let threshold_datum =
        if logic_is_on_main(
          reference_inputs,
          config.council_two_stage_hash,
          own_hash,
        ) {
          get_input_state_by_policy(
            reference_inputs,
            config.main_gov_threshold_hash,
          )
        } else {
          get_input_state_by_policy(
            reference_inputs,
            config.staging_gov_threshold_hash,
          )
        }

      // (GAS-2) Decode the chosen threshold datum into numerator and denominator components.
      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      }: MultisigThreshold = threshold_datum

      and {
        // (GAS-3) Require the technical-authority native script derived from the datum to appear in mint.
        check_for_multisig(
          reference_inputs,
          mint,
          config.technical_authority_forever_hash,
          technical_auth_numerator,
          technical_auth_denominator,
        ),
        // (GAS-4) Require the council native script derived from the datum to appear in mint.
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
    Withdrawing(Script(own_hash)) |
    Publishing {
      certificate: UnregisterCredential { credential: Script(own_hash), .. },
      ..
    } ->
      // (GAS-6) Enforce multisig thresholds for withdrawals and credential revocations.
      validation(own_hash)

    Publishing {
      certificate: RegisterCredential { credential: Script(own_hash), .. },
      ..
    } ->
      // (GAS-5) Touch `cnight_policy` so it contributes to the script hash; the inequality is only to stop the optimizer removing it.
      config.cnight_policy != own_hash

    _ -> fail
  }
}

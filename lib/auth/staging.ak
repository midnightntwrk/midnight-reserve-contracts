use cardano/address.{Script}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{Transaction}
use config
use multisig/script.{check_for_multisig}
use multisig/types.{MultisigThreshold}
use upgradable/two_stage_upgrade.{logic_is_on_main}
use utils.{get_input_state_by_policy}

/// Staging governance auth validation. Uses main or staging thresholds depending
/// on whether the logic is currently on main. Requires tech auth and council approval.
pub fn staging_auth_multisig_validation(
  transaction: Transaction,
  info: ScriptInfo,
) {
  let Transaction { reference_inputs, mint, .. } = transaction

  let validation =
    fn(own_hash) {
      // Use main or staging thresholds based on current logic state
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

      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      }: MultisigThreshold = threshold_datum

      and {
        check_for_multisig(
          reference_inputs,
          mint,
          config.technical_authority_forever_hash,
          technical_auth_numerator,
          technical_auth_denominator,
        ),
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
      validation(own_hash)

    Publishing {
      certificate: RegisterCredential { credential: Script(own_hash), .. },
      ..
    } ->
      // Touch cnight_policy so it contributes to the script hash
      config.cnight_policy != own_hash

    _ -> fail
  }
}

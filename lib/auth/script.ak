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
      let threshold_datum =
        get_input_state_by_policy(
          reference_inputs,
          config.main_gov_threshold_hash,
        )

      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      } = threshold_datum

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
    Withdrawing(_) | Publishing { certificate: UnregisterCredential { .. }, .. } ->
      validation()

    Publishing {
      certificate: RegisterCredential { credential: Script(own_hash), .. },
      ..
    } ->
      // This trick is simply to include cnight policy in the script hash
      // without the compiler optimizing the policy away
      config.cnight_policy != own_hash

    _ -> fail
  }
}

use cardano/address.{Script}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{Transaction}
use config
use multisig/script.{check_for_multisig}
use upgradable/two_stage_upgrade.{logic_is_on_main}

pub fn auth_multisig_validation(transaction: Transaction, info: ScriptInfo) {
  let Transaction { reference_inputs, mint, .. } = transaction

  let validation =
    fn(own_hash) {
      if logic_is_on_main(
        reference_inputs,
        config.council_two_stage_hash,
        own_hash,
      ) {
        and {
          check_for_multisig(
            reference_inputs,
            mint,
            config.technical_authority_forever_hash,
          ),
          check_for_multisig(
            reference_inputs,
            mint,
            config.council_forever_hash,
          ),
        }
      } else {
        check_for_multisig(
          reference_inputs,
          mint,
          config.technical_authority_forever_hash,
        )
      }
    }

  when info is {
    Withdrawing(Script(own_hash)) |
    Publishing {
      certificate: UnregisterCredential { credential: Script(own_hash), .. },
      ..
    } -> validation(own_hash)

    Publishing {
      certificate: RegisterCredential { credential: Script(own_hash), .. },
      ..
    } -> config.cnight_policy != own_hash

    _ -> fail
  }
}

use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/assets.{PolicyId, to_dict}
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/script_context.{Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}
use config
use multisig/script.{check_for_multisig}
use multisig/types.{MultisigThreshold}
use utils.{get_input_state_by_policy, must_find}

/// Checks if the given auth hash matches the one recorded on the main upgrade state.
fn auth_is_on_main(
  inputs: List<Input>,
  two_stage_hash: PolicyId,
  auth: ScriptHash,
) {
  let pay_cred = Script(two_stage_hash)
  let main_nft_id = [Pair(two_stage_hash, [Pair("main", 1)])] |> as_data

  let main_datum =
    must_find(
      inputs,
      fn(input) {
        let Output { address, value, .. } = input.output

        and {
          address.payment_credential == pay_cred,
          {
            expect [_, ..nft_id] = value |> to_dict |> to_pairs
            main_nft_id == as_data(nft_id)
          },
        }
      },
    ).output.datum

  expect InlineDatum(datum) = main_datum

  expect [_, _, current_auth, ..] = datum |> builtin.un_list_data

  builtin.un_b_data(current_auth) == auth
}

/// Staging governance auth validation. Uses main or staging thresholds depending
/// on whether the auth is currently on main. Requires tech auth and council approval.
pub fn staging_auth_multisig_validation(
  transaction: Transaction,
  two_stage_hash: PolicyId,
  info: ScriptInfo,
) {
  let Transaction { reference_inputs, mint, .. } = transaction

  let validation =
    fn(own_hash) {
      let threshold_datum =
        if auth_is_on_main(reference_inputs, two_stage_hash, own_hash) {
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
    } -> validation(own_hash)

    Publishing {
      certificate: RegisterCredential { credential: Script(own_hash), .. },
      ..
    } ->
      // Touch cnight_policy so it contributes to the script hash
      config.cnight_policy != own_hash

    _ -> fail
  }
}

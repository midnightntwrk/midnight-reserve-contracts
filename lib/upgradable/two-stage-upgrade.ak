use aiken/builtin
use aiken/collection/dict.{to_pairs}
use cardano/address.{Address, Script}
use cardano/assets.{to_dict}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use upgradable/types.{
  Auth, Logic, Main, MitigationAuth, MitigationLogic, Stage, Staging,
  TwoStageRedeemer,
}
use utils.{must_find, must_find_key}

pub const main_token_name = "main"

pub const staging_token_name = "staging"

fn expected_main_nft_id(own_policy) {
  [Pair(own_policy, [Pair(main_token_name, 1)])] |> as_data
}

fn expected_staging_nft_id(own_policy) {
  [Pair(own_policy, [Pair(staging_token_name, 1)])] |> as_data
}

// Validators in various repos will simply call this function
pub fn two_stage_upgradable(
  ctx: ScriptContext,
  one_shot_ref: OutputReference,
) -> Bool {
  let ScriptContext { transaction, redeemer, info } = ctx

  let Transaction { inputs, reference_inputs, mint, outputs, .. } = transaction

  when info is {
    // Used for initial 2 stage setup
    Minting(own_policy) ->
      validate_mint_tokens(own_policy, one_shot_ref, inputs, outputs, mint)

    Spending { output, .. } -> {
      let own_input =
        must_find(inputs, fn(input: Input) { input.output_reference == output })

      let Input { output: Output { address, value, datum, .. }, .. } = own_input

      expect Script(own_hash) as pay_cred = address.payment_credential

      expect InlineDatum(datum) = datum

      expect stage: Stage = datum

      // TODO Check auth field script is running here
      expect TwoStageRedeemer { update_field, which_stage }: TwoStageRedeemer =
        redeemer

      let expected_staging_nft_id = expected_staging_nft_id(own_hash)

      expect [_, ..nft_id] = value |> to_dict |> to_pairs

      let handle_stage =
        fn(fields_access_fn, callback) {
          when which_stage is {
            Main(staging_out_ref) -> {
              let Input {
                output: Output {
                  address: staging_addr,
                  value: staging_value,
                  datum: staging_datum,
                  ..
                },
                ..
              } =
                must_find(
                  reference_inputs,
                  fn(input: Input) { input.output_reference == staging_out_ref },
                )

              expect staging_addr.payment_credential == pay_cred

              expect [_, ..staging_nft_id] =
                staging_value |> to_dict |> to_pairs

              expect expected_staging_nft_id == ( staging_nft_id |> as_data )

              expect InlineDatum(staging_datum) = staging_datum

              expect staging_datum: Stage = staging_datum

              let expected_main_nft_id = expected_main_nft_id(own_hash)

              // Ensure our input actually does have the nft
              expect expected_main_nft_id == ( nft_id |> as_data )

              callback(fields_access_fn(staging_datum), staging_datum.round)
            }

            Staging(script_hash) -> {
              // Ensure our input actually does have the nft
              expect expected_staging_nft_id == ( nft_id |> as_data )

              callback(script_hash, stage.round + 1)
            }
          }
        }

      let expected_output_datum =
        when update_field is {
          Logic -> {
            let sh, new_round <- handle_stage(fn(stage: Stage) { stage.logic })

            Stage { ..stage, logic: sh, round: new_round }
          }

          Auth -> {
            let sh, new_round <- handle_stage(fn(stage: Stage) { stage.auth })

            Stage { ..stage, auth: sh, round: new_round }
          }
          // TODO double check mitigations are empty when updating
          MitigationLogic -> {
            let
              sh,
              new_round,
            <- handle_stage(fn(stage: Stage) { stage.mitigation_logic })

            Stage { ..stage, mitigation_logic: sh, round: new_round }
          }
          MitigationAuth -> {
            let
              sh,
              new_round,
            <- handle_stage(fn(stage: Stage) { stage.mitigation_auth })

            Stage { ..stage, mitigation_auth: sh, round: new_round }
          }
        }
          |> InlineDatum

      expect [
        Output { address: out_addr, value: out_value, datum: out_datum, .. },
        ..
      ] = outputs

      expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

      and {
        out_addr.payment_credential == pay_cred,
        out_nft_id == nft_id,
        out_datum == expected_output_datum,
      }
    }

    _ -> fail
  }
}

fn validate_mint_tokens(own_policy, one_shot_ref, inputs, outputs, mint) {
  let own_tokens = mint |> to_dict |> to_pairs |> must_find_key(own_policy)
  // "m" is lexographically before "s"
  let minted_tokens = [Pair(main_token_name, 1), Pair(staging_token_name, 1)]

  // Can only mint one staging and main token
  expect ( own_tokens |> to_pairs ) == minted_tokens

  // Spend a determined input so minting can only happen once
  expect _ =
    must_find(
      inputs,
      fn(input: Input) { input.output_reference == one_shot_ref },
    )

  // Tokens must be paid out to own script payment address
  let expected_pay_cred = Script(own_policy)

  // First output is main
  expect [main, ..rest_outputs] = outputs

  // Datum must be inline cus hash is crazy
  expect Output {
    address: Address { payment_credential: out_pay_cred, .. },
    value,
    datum: InlineDatum(main_datum),
    ..
  } = main

  expect out_pay_cred == expected_pay_cred

  expect [_, ..main_nft_id] = value |> to_dict |> to_pairs

  expect expected_main_nft_id(own_policy) == ( main_nft_id |> as_data )

  expect Stage {
    logic,
    mitigation_logic: "",
    auth,
    mitigation_auth: "",
    round: 0,
  } = main_datum

  expect builtin.length_of_bytearray(logic) == 28

  expect builtin.length_of_bytearray(auth) == 28

  // Second output is staging
  expect [staging, ..] = rest_outputs

  // Datum must be inline cus hash is crazy
  expect Output {
    address: Address { payment_credential: out_pay_cred, .. },
    value,
    datum: InlineDatum(staging_datum),
    ..
  } = staging

  expect out_pay_cred == expected_pay_cred

  expect [_, ..staging_nft_id] = value |> to_dict |> to_pairs

  expect expected_staging_nft_id(own_policy) == ( staging_nft_id |> as_data )

  expect Stage {
    logic,
    mitigation_logic: "",
    auth,
    mitigation_auth: "",
    round: 0,
  } = staging_datum

  expect builtin.length_of_bytearray(logic) == 28

  builtin.length_of_bytearray(auth) == 28
}

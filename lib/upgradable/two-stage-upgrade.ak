use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Credential, Script}
use cardano/assets.{PolicyId, Value, to_dict}
use cardano/script_context.{Minting, ScriptInfo, Spending}
use cardano/transaction.{
  Datum, InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use upgradable/types.{
  Auth, Logic, Main, MitigationAuth, MitigationLogic, Staging, TwoStageRedeemer,
  UpdateField, UpgradeState,
}
use utils.{must_find, must_find_key}

pub const main_token_name = "main"

pub const staging_token_name = "staging"

const empty = ""

fn expected_main_nft_id(own_policy) {
  [Pair(own_policy, [Pair(main_token_name, 1)])] |> as_data
}

fn expected_staging_nft_id(own_policy) {
  [Pair(own_policy, [Pair(staging_token_name, 1)])] |> as_data
}

// Validators in various repos will simply call this function
pub fn two_stage_upgradable(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  one_shot_ref: OutputReference,
) -> Bool {
  let Transaction { inputs, reference_inputs, mint, outputs, withdrawals, .. } =
    transaction

  when info is {
    // Used for initial 2 stage setup
    Minting(own_policy) ->
      validate_mint_tokens(own_policy, one_shot_ref, inputs, outputs, mint)

    Spending { output, .. } -> {
      let own_input =
        must_find(inputs, fn(input: Input) { input.output_reference == output })

      // State of either main or staging depending on which input is spent
      let Input {
        output: Output { address, value, datum: spending_datum, .. },
        ..
      } = own_input

      expect Script(own_hash) as pay_cred = address.payment_credential

      expect TwoStageRedeemer { update_field, which_stage }: TwoStageRedeemer =
        redeemer

      let expected_staging_nft_id = expected_staging_nft_id(own_hash)

      let expected_main_nft_id = expected_main_nft_id(own_hash)

      expect [_, ..nft_id] = value |> to_dict |> to_pairs

      let expected_output_datum: UpgradeState =
        when which_stage is {
          Main(staging_out_ref) -> {
            // validate main token
            expect ( nft_id |> as_data ) == expected_main_nft_id

            // Ledger rules prevent an input from being
            // both referenced and spent so staging remains unchanged
            let staging_input =
              reference_inputs
                |> must_find(
                    fn(input: Input) {
                      input.output_reference == staging_out_ref
                    },
                  )

            let Input {
              output: Output {
                address: staging_addr,
                value: staging_value,
                datum: staging_datum,
                ..
              },
              ..
            } = staging_input

            //validate fields on staging ref input
            expect staging_addr.payment_credential == pay_cred

            expect [_, ..staging_nft_id] = staging_value |> to_dict |> to_pairs

            expect ( staging_nft_id |> as_data ) == expected_staging_nft_id

            validate_main_update(
              update_field,
              spending_datum,
              staging_datum,
              withdrawals,
            )
          }

          Staging(main_out_ref, new_script_hash) -> {
            // validate staging token
            expect ( nft_id |> as_data ) == expected_staging_nft_id

            let main_input =
              must_find(
                reference_inputs,
                fn(input: Input) { input.output_reference == main_out_ref },
              )

            // Ledger rules prevent an input from being
            // both referenced and spent so main remains unchanged
            let Input {
              output: Output {
                address: main_addr,
                value: main_value,
                datum: main_datum,
                ..
              },
              ..
            } = main_input

            //validate staging ref input
            expect main_addr.payment_credential == pay_cred

            expect [_, ..main_nft_id] = main_value |> to_dict |> to_pairs

            expect ( main_nft_id |> as_data ) == expected_main_nft_id

            validate_staging_update(
              update_field,
              new_script_hash,
              spending_datum,
              main_datum,
              withdrawals,
            )
          }
        }

      let expected_output_datum = InlineDatum(expected_output_datum)

      expect [
        Output { address: out_addr, value: out_value, datum: out_datum, .. },
        ..
      ] = outputs

      expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

      and {
        out_addr.payment_credential == pay_cred,
        out_nft_id == nft_id,
        out_datum == expected_output_datum,
      }?
    }

    _ -> fail
  }
}

fn validate_main_update(
  update_field: UpdateField,
  spending_datum: Datum,
  staging_datum: Datum,
  withdrawals,
) {
  expect InlineDatum(spending_datum) = spending_datum

  expect InlineDatum(staging_datum) = staging_datum

  expect UpgradeState { logic, mitigation_logic, auth, mitigation_auth, .. }: UpgradeState =
    spending_datum

  let auth_cred = Script(auth)

  // validate auth scripts are run
  expect validate_running(auth_cred, mitigation_auth, withdrawals)

  when update_field is {
    Logic -> {
      expect UpgradeState { logic, round, .. }: UpgradeState = staging_datum

      UpgradeState { logic, mitigation_logic, auth, mitigation_auth, round }
    }

    Auth -> {
      expect UpgradeState { auth, round, .. }: UpgradeState = staging_datum

      UpgradeState { logic, mitigation_logic, auth, mitigation_auth, round }
    }

    MitigationLogic -> {
      // Can only set the mitigation logic script once
      expect mitigation_logic == ""

      expect UpgradeState { mitigation_logic: new_mitigation, round, .. } =
        staging_datum

      UpgradeState {
        logic,
        mitigation_logic: new_mitigation,
        auth,
        mitigation_auth,
        round,
      }
    }

    MitigationAuth -> {
      // Can only set the mitigation logic script once
      expect mitigation_auth == ""

      expect UpgradeState { mitigation_auth: new_mitigation, round, .. } =
        staging_datum

      UpgradeState {
        logic,
        mitigation_logic,
        auth,
        mitigation_auth: new_mitigation,
        round,
      }
    }
  }
}

fn validate_staging_update(
  update_field: UpdateField,
  new_val: ScriptHash,
  spending_datum: Datum,
  main_datum: Datum,
  withdrawals,
) {
  // Check new value is proper script hash
  expect builtin.length_of_bytearray(new_val) == 28

  expect InlineDatum(spending_datum) = spending_datum

  expect InlineDatum(main_datum) = main_datum

  expect UpgradeState { logic, mitigation_logic, auth, mitigation_auth, round } =
    spending_datum

  expect UpgradeState {
    mitigation_logic: main_mitigation_logic,
    auth: main_auth,
    mitigation_auth: main_mitigation_auth,
    ..
  } = main_datum

  let auth_cred = Script(auth)

  let main_auth_cred = Script(main_auth)

  // validate auth scripts are run
  // We allow either staging auth or main auth
  // (In case staging auth is accidentally stuck)
  expect or {
      validate_running(auth_cred, mitigation_auth, withdrawals),
      // Special case for MitigationAuth
      if update_field == MitigationAuth {
        empty
      } else {
        main_mitigation_auth
      }
        |> validate_running(main_auth_cred, _, withdrawals),
    }

  when update_field is {
    Logic ->
      UpgradeState {
        logic: new_val,
        mitigation_logic,
        auth,
        mitigation_auth,
        round: round + 1,
      }

    Auth ->
      UpgradeState {
        logic,
        mitigation_logic,
        auth: new_val,
        mitigation_auth,
        round: round + 1,
      }

    MitigationLogic -> {
      // Can only set the mitigation logic script if main is not yet set
      expect main_mitigation_logic == ""

      UpgradeState {
        logic,
        mitigation_logic: new_val,
        auth,
        mitigation_auth,
        round: round + 1,
      }
    }

    MitigationAuth -> {
      // Can only set the mitigation auth script if main is not yet set
      expect main_mitigation_auth == ""

      UpgradeState {
        logic,
        mitigation_logic,
        auth,
        mitigation_auth: new_val,
        round: round + 1,
      }
    }
  }
}

pub fn validate_running(
  auth_cred: Credential,
  mitigation_auth: ScriptHash,
  withdrawals,
) -> Bool {
  and {
    list.any(
      withdrawals,
      fn(withdrawal: Pair<Credential, Int>) { withdrawal.1st == auth_cred },
    ),
    or {
      mitigation_auth == "",
      {
        let mitigation_auth_cred = Script(mitigation_auth)
        list.any(
          withdrawals,
          fn(withdrawal: Pair<Credential, Int>) {
            withdrawal.1st == mitigation_auth_cred
          },
        )
      },
    },
  }
}

fn validate_mint_tokens(
  own_policy: PolicyId,
  one_shot_ref: OutputReference,
  inputs: List<Input>,
  outputs: List<Output>,
  mint: Value,
) {
  let own_tokens = mint |> to_dict |> to_pairs |> must_find_key(own_policy)
  // "m" is lexographically before "s"
  let minted_tokens = [Pair(main_token_name, 1), Pair(staging_token_name, 1)]

  // Can only mint one staging and main token
  expect ( own_tokens |> to_pairs ) == minted_tokens

  // Spend a determined input so minting can only happen once
  expect
    list.any(
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

  expect UpgradeState {
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

  // Datum must be inline
  expect Output {
    address: Address { payment_credential: out_pay_cred, .. },
    value,
    datum: InlineDatum(staging_datum),
    ..
  } = staging

  expect out_pay_cred == expected_pay_cred

  expect [_, ..staging_nft_id] = value |> to_dict |> to_pairs

  expect expected_staging_nft_id(own_policy) == ( staging_nft_id |> as_data )

  expect UpgradeState {
    logic,
    mitigation_logic: "",
    auth,
    mitigation_auth: "",
    round: 0,
  } = staging_datum

  expect builtin.length_of_bytearray(logic) == 28

  builtin.length_of_bytearray(auth) == 28
}

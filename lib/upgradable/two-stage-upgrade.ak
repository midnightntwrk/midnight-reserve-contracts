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
use config
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

/// Core two-stage upgrade logic used by all two-stage validators.
/// On minting: creates main and staging NFTs with initial upgrade state.
/// On spending: either promotes a staged change to main, or stages a new change.
pub fn two_stage_upgradable(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  one_shot_ref: OutputReference,
) -> Bool {
  let Transaction { inputs, reference_inputs, mint, outputs, withdrawals, .. } =
    transaction

  when info is {
    Minting(own_policy) ->
      validate_mint_tokens(own_policy, one_shot_ref, inputs, outputs, mint)

    Spending { output, .. } -> {
      trace @"TWO_STAGE: Spending branch entered"
      let own_input =
        must_find(inputs, fn(input: Input) { input.output_reference == output })

      let Input {
        output: Output { address, value, datum: spending_datum, .. },
        ..
      } = own_input

      expect Script(own_hash) as pay_cred = address.payment_credential

      trace @"TWO_STAGE: Decoding redeemer..."
      expect TwoStageRedeemer { update_field, which_stage }: TwoStageRedeemer =
        redeemer

      let expected_staging_nft_id = expected_staging_nft_id(own_hash)

      let expected_main_nft_id = expected_main_nft_id(own_hash)

      expect [_, ..nft_id] = value |> to_dict |> to_pairs

      let expected_output_datum: UpgradeState =
        when which_stage is {
          Main(staging_out_ref) -> {
            // Spending main NFT to promote staged change
            expect ( nft_id |> as_data ) == expected_main_nft_id

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

            expect staging_addr.payment_credential == pay_cred

            expect [_, ..staging_nft_id] = staging_value |> to_dict |> to_pairs

            expect ( staging_nft_id |> as_data ) == expected_staging_nft_id

            promote_staging_field_to_main(
              update_field,
              spending_datum,
              staging_datum,
              withdrawals,
            )
          }

          Staging(main_out_ref, new_script_hash) -> {
            trace @"STAGING: Entry"
            trace new_script_hash
            // Spending staging NFT to stage a new change
            expect ( nft_id |> as_data ) == expected_staging_nft_id

            trace @"STAGING: NFT validated, finding main reference input"
            let main_input =
              must_find(
                reference_inputs,
                fn(input: Input) { input.output_reference == main_out_ref },
              )

            trace @"STAGING: Main reference input found, extracting data"
            let Input {
              output: Output {
                address: main_addr,
                value: main_value,
                datum: main_datum,
                ..
              },
              ..
            } = main_input

            trace @"STAGING: Validating main reference credential"
            expect main_addr.payment_credential == pay_cred

            expect [_, ..main_nft_id] = main_value |> to_dict |> to_pairs

            trace @"STAGING: Validating main reference NFT"
            expect ( main_nft_id |> as_data ) == expected_main_nft_id

            trace @"STAGING: All checks passed, calling update_staging_field"
            update_staging_field(
              update_field,
              new_script_hash,
              spending_datum,
              main_datum,
              withdrawals,
            )
          }
        }

      let expected_output_datum = InlineDatum(expected_output_datum)

      let Output { value: out_value, datum: out_datum, .. } =
        must_find(
          outputs,
          fn(output) { output.address.payment_credential == pay_cred },
        )

      expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

      // NFT identity unchanged and new state written inline
      and {
        out_nft_id == nft_id,
        out_datum == expected_output_datum,
      }?
    }

    _ -> fail
  }
}

/// Promotes a staged field to main. Requires auth scripts to be running.
fn promote_staging_field_to_main(
  update_field: UpdateField,
  spending_datum: Datum,
  staging_datum: Datum,
  withdrawals,
) {
  expect InlineDatum(spending_datum) = spending_datum

  expect InlineDatum(staging_datum) = staging_datum

  expect UpgradeState {
    logic,
    mitigation_logic,
    auth,
    mitigation_auth,
    round,
    logic_round,
  }: UpgradeState = spending_datum

  // Both auth scripts must be running via withdrawals
  expect validate_running(auth, mitigation_auth, withdrawals)

  when update_field is {
    Logic -> {
      expect UpgradeState { logic, logic_round, .. }: UpgradeState =
        staging_datum

      UpgradeState {
        logic,
        mitigation_logic,
        auth,
        mitigation_auth,
        round,
        logic_round,
      }
    }

    Auth -> {
      expect UpgradeState { auth, round, .. }: UpgradeState = staging_datum

      UpgradeState {
        logic,
        mitigation_logic,
        auth,
        mitigation_auth,
        round,
        logic_round,
      }
    }

    MitigationLogic -> {
      // Can only set mitigation logic once (when empty)
      expect mitigation_logic == ""

      expect UpgradeState { mitigation_logic: new_mitigation, round, .. } =
        staging_datum

      UpgradeState {
        logic,
        mitigation_logic: new_mitigation,
        auth,
        mitigation_auth,
        round,
        logic_round,
      }
    }

    MitigationAuth -> {
      // Can only set mitigation auth once (when empty)
      expect mitigation_auth == ""

      expect UpgradeState { mitigation_auth: new_mitigation, round, .. } =
        staging_datum

      UpgradeState {
        logic,
        mitigation_logic,
        auth,
        mitigation_auth: new_mitigation,
        round,
        logic_round,
      }
    }
  }
}

/// Updates a field in staging. Allows either staging or main auth (for recovery).
fn update_staging_field(
  update_field: UpdateField,
  new_val: ScriptHash,
  spending_datum: Datum,
  main_datum: Datum,
  withdrawals,
) {
  trace @"UPDATE_STAGING: Entry"
  // Script hash must be 28 bytes
  expect builtin.length_of_bytearray(new_val) == 28

  trace @"UPDATE_STAGING: Hash length validated"
  expect InlineDatum(spending_datum) = spending_datum

  trace @"UPDATE_STAGING: Staging datum is inline"
  expect InlineDatum(main_datum) = main_datum

  trace @"UPDATE_STAGING: Main datum is inline, decoding staging"
  expect UpgradeState {
    logic,
    mitigation_logic,
    auth,
    mitigation_auth,
    round,
    logic_round,
  } = spending_datum

  trace @"UPDATE_STAGING: Staging decoded, auth="
  trace auth
  expect UpgradeState {
    mitigation_logic: main_mitigation_logic,
    auth: main_auth,
    mitigation_auth: main_mitigation_auth,
    ..
  } = main_datum

  trace @"UPDATE_STAGING: Main decoded, auth="
  trace main_auth
  trace @"UPDATE_STAGING: Validating auth scripts"
  // Allow either staging auth or main auth (for recovery if staging is stuck)
  expect or {
      if update_field == MitigationAuth {
        empty
      } else {
        mitigation_auth
      }
        |> validate_running(auth, _, withdrawals),
      validate_running(main_auth, main_mitigation_auth, withdrawals),
    }

  when update_field is {
    Logic ->
      UpgradeState {
        logic: new_val,
        mitigation_logic,
        auth,
        mitigation_auth,
        round,
        logic_round: logic_round + 1,
      }

    Auth ->
      UpgradeState {
        logic,
        mitigation_logic,
        auth: new_val,
        mitigation_auth,
        round: round + 1,
        logic_round,
      }

    MitigationLogic -> {
      // Can only stage mitigation logic if main is not yet set
      expect main_mitigation_logic == ""

      UpgradeState {
        logic,
        mitigation_logic: new_val,
        auth,
        mitigation_auth,
        round: round + 1,
        logic_round,
      }
    }

    MitigationAuth -> {
      // Can only stage mitigation auth if main is not yet set
      expect main_mitigation_auth == ""

      UpgradeState {
        logic,
        mitigation_logic,
        auth,
        mitigation_auth: new_val,
        round: round + 1,
        logic_round,
      }
    }
  }
}

/// Validates that both auth scripts appear in withdrawals.
/// Mitigation auth is only required when it's set (non-empty).
pub fn validate_running(
  auth: ScriptHash,
  mitigation_auth: ScriptHash,
  withdrawals,
) -> Bool {
  trace @"VALIDATE_RUNNING: auth="
  trace auth
  let auth_cred = Script(auth)

  trace @"VALIDATE_RUNNING: Checking for auth withdrawal"
  let auth_found = list.any(
      withdrawals,
      fn(withdrawal: Pair<Credential, Int>) { withdrawal.1st == auth_cred },
    )

  trace if auth_found { @"VALIDATE_RUNNING: Auth withdrawal found" } else { @"VALIDATE_RUNNING: Auth withdrawal NOT found" }

  let mitigation_check = or {
      mitigation_auth == "",
      {
        trace @"VALIDATE_RUNNING: Checking for mitigation auth withdrawal"
        let mitigation_auth_cred = Script(mitigation_auth)
        list.any(
          withdrawals,
          fn(withdrawal: Pair<Credential, Int>) {
            withdrawal.1st == mitigation_auth_cred
          },
        )
      },
    }

  and {
    // (RUN-1) Require at least one withdrawal signed by the main auth credential.
    auth_found,
    mitigation_check,
  }
}

/// Validates initial minting of main and staging NFTs with proper upgrade state.
fn validate_mint_tokens(
  own_policy: PolicyId,
  one_shot_ref: OutputReference,
  inputs: List<Input>,
  outputs: List<Output>,
  mint: Value,
) {
  let own_tokens = mint |> to_dict |> to_pairs |> must_find_key(own_policy)
  // "main" before "staging" lexicographically
  let minted_tokens = [Pair(main_token_name, 1), Pair(staging_token_name, 1)]

  // Must mint exactly one main and one staging token
  expect ( own_tokens |> to_pairs ) == minted_tokens

  // One-shot input must be consumed
  expect
    list.any(
      inputs,
      fn(input: Input) { input.output_reference == one_shot_ref },
    )

  let expected_pay_cred = Script(own_policy)

  expect [main, ..rest_outputs] = outputs

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
    logic_round: 0,
  } = main_datum

  // Initial hashes must be valid 28-byte script hashes
  expect builtin.length_of_bytearray(logic) == 28

  expect builtin.length_of_bytearray(auth) == 28

  expect [staging, ..] = rest_outputs

  expect Output {
    address: Address { payment_credential: out_pay_cred, .. },
    value,
    datum: InlineDatum(staging_datum),
    ..
  } = staging

  expect out_pay_cred == expected_pay_cred

  expect [_, ..staging_nft_id] = value |> to_dict |> to_pairs

  expect UpgradeState {
    logic,
    mitigation_logic: "",
    auth,
    mitigation_auth: "",
    round: 0,
    logic_round: 0,
  } = staging_datum

  and {
    expected_staging_nft_id(own_policy) == ( staging_nft_id |> as_data ),
    builtin.length_of_bytearray(logic) == 28,
    builtin.length_of_bytearray(auth) == 28,
    // Touch cnight_policy so it contributes to the script hash
    own_policy != config.cnight_policy,
  }
}

/// Checks if the given logic hash matches the one recorded on the main upgrade state.
/// Used to determine whether to use main or staging thresholds.
pub fn logic_is_on_main(
  inputs: List<Input>,
  two_stage_hash: PolicyId,
  logic: ScriptHash,
) {
  let pay_cred = Script(two_stage_hash)
  let main_nft_id = expected_main_nft_id(two_stage_hash)

  let main_datum =
    must_find(
      inputs,
      fn(input) {
        let Output { address, value, .. } = input.output

        // Lazy evaluation: stops early if payment credential doesn't match
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

  expect [current_logic, ..] = datum |> builtin.un_list_data

  builtin.un_b_data(current_logic) == logic
}

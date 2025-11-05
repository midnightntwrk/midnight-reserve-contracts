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
      // (TS-1) Validate that minting spends the one-shot input and issues the main/staging NFTs with correct inline datums.
      validate_mint_tokens(own_policy, one_shot_ref, inputs, outputs, mint)

    Spending { output, .. } -> {
      // (TS-2) Require the spending transaction to consume the script UTXO targeted by the ledger.
      let own_input =
        must_find(inputs, fn(input: Input) { input.output_reference == output })

      // State of either main or staging depending on which input is spent
      let Input {
        output: Output { address, value, datum: spending_datum, .. },
        ..
      } = own_input

      // (TS-3) Ensure the spent UTXO is locked by this script.
      expect Script(own_hash) as pay_cred = address.payment_credential

      // (TS-4) Decode the redeemer into the staged update request.
      expect TwoStageRedeemer { update_field, which_stage }: TwoStageRedeemer =
        redeemer

      let expected_staging_nft_id = expected_staging_nft_id(own_hash)

      let expected_main_nft_id = expected_main_nft_id(own_hash)

      // (TS-5) Capture the policy/token present on the spending output for later comparison.
      expect [_, ..nft_id] = value |> to_dict |> to_pairs

      let expected_output_datum: UpgradeState =
        when which_stage is {
          Main(staging_out_ref) -> {
            // validate main token
            // (TSM-1) Enforce that the main branch spends the main NFT.
            expect ( nft_id |> as_data ) == expected_main_nft_id

            // Ledger rules prevent an input from being
            // both referenced and spent so staging remains unchanged
            let staging_input =
              reference_inputs
                |> must_find(
                    fn(input: Input) {
                      // (TSM-2) Require the referenced staging UTXO indicated in the redeemer.
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
            // (TSM-3) Ensure the staging reference is locked by this script.
            expect staging_addr.payment_credential == pay_cred

            expect [_, ..staging_nft_id] = staging_value |> to_dict |> to_pairs

            // (TSM-4) Require the staging reference to hold the staging NFT.
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
            // (TSS-1) Enforce that the staging branch spends the staging NFT.
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
            // (TSS-2) Ensure the main reference is locked by this script.
            expect main_addr.payment_credential == pay_cred

            expect [_, ..main_nft_id] = main_value |> to_dict |> to_pairs

            // (TSS-3) Require the main reference to hold the main NFT.
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

      // (TS-6) Demand the updated script output remains at the same payment credential with the same NFT.
      expect [
        Output { address: out_addr, value: out_value, datum: out_datum, .. },
        ..
      ] = outputs

      expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

      and {
        // (TS-7) Preserve the payment credential on the evolved output.
        out_addr.payment_credential == pay_cred,
        // (TS-8) Ensure the NFT identity is unchanged across the spend.
        out_nft_id == nft_id,
        // (TS-9) Require the evolved state to be written as an inline datum.
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
  // (TM-1) Require the spending datum to be inline.
  expect InlineDatum(spending_datum) = spending_datum

  // (TM-2) Require the staging datum to be inline.
  expect InlineDatum(staging_datum) = staging_datum

  // (TM-3) Decode the spending datum into an `UpgradeState` record.
  expect UpgradeState { logic, mitigation_logic, auth, mitigation_auth, .. }: UpgradeState =
    spending_datum

  // validate auth scripts are run
  // (TM-4) Ensure both main auth hashes appear in withdrawals.
  expect validate_running(auth, mitigation_auth, withdrawals)

  when update_field is {
    Logic -> {
      // (TM-5) Pull the staged logic payload for comparison.
      expect UpgradeState { logic, round, .. }: UpgradeState = staging_datum

      UpgradeState { logic, mitigation_logic, auth, mitigation_auth, round }
    }

    Auth -> {
      // (TM-6) Pull the staged auth payload for comparison.
      expect UpgradeState { auth, round, .. }: UpgradeState = staging_datum

      UpgradeState { logic, mitigation_logic, auth, mitigation_auth, round }
    }

    MitigationLogic -> {
      // Can only set the mitigation logic script once
      // (TM-7) Forbid changing the mitigation logic once populated.
      expect mitigation_logic == ""

      // (TM-8) Pull the staged mitigation logic payload for the update.
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
  // (TSG-1) Enforce the redeemer-supplied script hash to be 28 bytes.
  expect builtin.length_of_bytearray(new_val) == 28

  // (TSG-2) Require the staging datum to be inline.
  expect InlineDatum(spending_datum) = spending_datum

  // (TSG-3) Require the main datum to be inline.
  expect InlineDatum(main_datum) = main_datum

  // (TSG-4) Decode the staging datum into an `UpgradeState`.
  expect UpgradeState { logic, mitigation_logic, auth, mitigation_auth, round } =
    spending_datum

  // (TSG-5) Decode the main datum for comparison.
  expect UpgradeState {
    mitigation_logic: main_mitigation_logic,
    auth: main_auth,
    mitigation_auth: main_mitigation_auth,
    ..
  } = main_datum

  // validate auth scripts are run
  // We allow either staging auth or main auth
  // (In case staging auth is accidentally stuck)
  // (TSG-6) Accept the spend only if either the staging auth pair or the main auth pair appears in withdrawals.
  expect or {
      validate_running(auth, mitigation_auth, withdrawals),
      // Special case for MitigationAuth
      if update_field == MitigationAuth {
        // fixes highlighting issue with tree sitter
        empty
      } else {
        main_mitigation_auth
      }
        |> validate_running(main_auth, _, withdrawals),
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
      // (TSG-7) Block staging mitigation updates once the main state is populated.
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
      // (TSG-8) Block staging mitigation auth updates once the main state is populated.
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
  auth: ScriptHash,
  mitigation_auth: ScriptHash,
  withdrawals,
) -> Bool {
  let auth_cred = Script(auth)

  and {
    // (RUN-1) Require at least one withdrawal signed by the main auth credential.
    list.any(
      withdrawals,
      fn(withdrawal: Pair<Credential, Int>) { withdrawal.1st == auth_cred },
    ),
    or {
      // (RUN-2) Allow the mitigation auth absence only when the datum stores an empty hash.
      mitigation_auth == "",
      {
        let mitigation_auth_cred = Script(mitigation_auth)
        // (RUN-3) Require a withdrawal signed by the mitigation auth credential whenever the datum records a non-empty hash.
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
  // (TSM-5) Extract the tokens minted under this policy; fail if the policy is absent.
  let own_tokens = mint |> to_dict |> to_pairs |> must_find_key(own_policy)
  // "m" is lexographically before "s"
  let minted_tokens = [Pair(main_token_name, 1), Pair(staging_token_name, 1)]

  // Can only mint one staging and main token
  // (TSM-6) Enforce minting exactly one "main" and one "staging" token.
  expect ( own_tokens |> to_pairs ) == minted_tokens

  // Spend a determined input so minting can only happen once
  // (TSM-7) Require the transaction to consume the configured one-shot input.
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
  // (TSM-8) Demand the main output be paid to this script with an inline datum.
  expect Output {
    address: Address { payment_credential: out_pay_cred, .. },
    value,
    datum: InlineDatum(main_datum),
    ..
  } = main

  // (TSM-9) Ensure the main output is locked by this script.
  expect out_pay_cred == expected_pay_cred

  expect [_, ..main_nft_id] = value |> to_dict |> to_pairs

  // (TSM-10) Require the main output to carry the main NFT.
  expect expected_main_nft_id(own_policy) == ( main_nft_id |> as_data )

  expect UpgradeState {
    logic,
    mitigation_logic: "",
    auth,
    mitigation_auth: "",
    round: 0,
  } = main_datum

  // (TSM-11) Ensure the initial main logic hash is 28 bytes.
  expect builtin.length_of_bytearray(logic) == 28

  // (TSM-12) Ensure the initial main auth hash is 28 bytes.
  expect builtin.length_of_bytearray(auth) == 28

  // Second output is staging
  expect [staging, ..] = rest_outputs

  // Datum must be inline
  // (TSM-13) Demand the staging output be paid to this script with an inline datum.
  expect Output {
    address: Address { payment_credential: out_pay_cred, .. },
    value,
    datum: InlineDatum(staging_datum),
    ..
  } = staging

  // (TSM-14) Ensure the staging output is locked by this script.
  expect out_pay_cred == expected_pay_cred

  expect [_, ..staging_nft_id] = value |> to_dict |> to_pairs

  expect UpgradeState {
    logic,
    mitigation_logic: "",
    auth,
    mitigation_auth: "",
    round: 0,
  } = staging_datum

  and {
    // (TSM-15) Require the staging output to carry the staging NFT.
    expected_staging_nft_id(own_policy) == ( staging_nft_id |> as_data ),
    // (TSM-16) Ensure the initial staging logic hash is 28 bytes.
    builtin.length_of_bytearray(logic) == 28,
    // (TSM-17) Ensure the initial staging auth hash is 28 bytes.
    builtin.length_of_bytearray(auth) == 28,
    // This trick is simply to include cnight policy in the script hash
    // without the compiler optimizing the policy away
    // (TSM-18) Touch `cnight_policy` so it contributes to the script hash; the inequality is only to stop the optimizer removing it.
    own_policy != config.cnight_policy,
  }
}

pub fn logic_is_on_main(
  inputs: List<Input>,
  two_stage_hash: PolicyId,
  logic: ScriptHash,
) {
  let pay_cred = Script(two_stage_hash)
  let main_nft_id = expected_main_nft_id(two_stage_hash)

  // (LIM-1) Locate the main upgrade UTXO locked by this script and carrying the main NFT.
  let main_datum =
    must_find(
      inputs,
      fn(input) {
        let Output { address, value, .. } = input.output

        // Remember and is lazy and will not evaluate cases further
        // if one returned false
        and {
          address.payment_credential == pay_cred,
          {
            expect [_, ..nft_id] = value |> to_dict |> to_pairs
            main_nft_id == as_data(nft_id)
          },
        }
      },
    ).output.datum

  // (LIM-2) Require the main datum to be provided inline.
  expect InlineDatum(datum) = main_datum

  // (LIM-3) Extract the recorded logic hash from the datum for comparison.
  expect [current_logic, ..] = datum |> builtin.un_list_data

  // (LIM-4) Confirm the datum records the supplied logic hash.
  builtin.un_b_data(current_logic) == logic
}

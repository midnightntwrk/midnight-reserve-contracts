use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{add, from_asset, from_lovelace}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use config
use reserve
use upgradable/types.{UpgradeState}

const policy = #"00000000000000000000000000000000000000000000000000000002"

const one_shot_ref =
  OutputReference(config.reserve_one_shot_hash, config.reserve_one_shot_index)

const address =
  Address(
    VerificationKey(#"11111111111111111111111111111111111111111111111111111111"),
    None,
  )

const script_address = Address(Script(policy), None)

const val = assets.zero

const initial_datum = #"01"

const logic_script_hash =
  #"33333333333333333333333333333333333333333333333333333333"

const mitigation_logic_script_hash =
  #"44444444444444444444444444444444444444444444444444444444"

const auth_script_hash =
  #"55555555555555555555555555555555555555555555555555555555"

const mitigation_auth_script_hash =
  #"66666666666666666666666666666666666666666666666666666666"

const two_stage_policy = config.reserve_two_stage_hash

const two_stage_script_address = Address(Script(two_stage_policy), None)

const main_state_datum =
  UpgradeState(
    logic_script_hash,
    mitigation_logic_script_hash,
    auth_script_hash,
    mitigation_auth_script_hash,
    0,
  )

const spending_out_ref =
  OutputReference(
    #"99999999999999999999999999999999999999999999999999999999",
    1,
  )

const main_ref_out_ref =
  OutputReference(
    #"88888888888888888888888888888888888888888888888888888888",
    0,
  )

test forever_mint() {
  let mint = from_asset(policy, "", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, InlineDatum(0), None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "", 1),
          InlineDatum(initial_datum),
          None,
        ),
      ],
    }

  let ctx = ScriptContext(tx, 0, Minting(policy))

  reserve.reserve_forever.else(ctx)
}

test forever_spending() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          spending_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "", 1),
            InlineDatum(initial_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          main_ref_out_ref,
          Output(
            two_stage_script_address,
            from_lovelace(10000000) |> add(two_stage_policy, "main", 1),
            InlineDatum(main_state_datum),
            None,
          ),
        ),
      ],
      withdrawals: [
        Pair(Script(logic_script_hash), 0),
        Pair(Script(mitigation_logic_script_hash), 0),
      ],
    }

  let ctx = ScriptContext(tx, 0, Spending(spending_out_ref, None))

  reserve.reserve_forever.else(ctx)
}

test forever_mint_different_redeemer() {
  let mint = from_asset(policy, "", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, InlineDatum(0), None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "", 1),
          InlineDatum(initial_datum),
          None,
        ),
      ],
    }

  let ctx = ScriptContext(tx, #"01", Minting(policy))

  reserve.reserve_forever.else(ctx)
}

test forever_spending_empty_mitigation() {
  let main_state_datum_empty_mitigation =
    UpgradeState(
      logic_script_hash,
      "",
      auth_script_hash,
      mitigation_auth_script_hash,
      0,
    )

  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          spending_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "", 1),
            InlineDatum(initial_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          main_ref_out_ref,
          Output(
            two_stage_script_address,
            from_lovelace(10000000) |> add(two_stage_policy, "main", 1),
            InlineDatum(main_state_datum_empty_mitigation),
            None,
          ),
        ),
      ],
      withdrawals: [Pair(Script(logic_script_hash), 0)],
    }

  let ctx = ScriptContext(tx, 0, Spending(spending_out_ref, None))

  reserve.reserve_forever.else(ctx)
}

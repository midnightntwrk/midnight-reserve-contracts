use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{add, from_asset, from_lovelace}
use cardano/script_context.{Minting, ScriptContext, Spending, Withdrawing}
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

test forever_mint_extra_tokens_fail() fail {
  let mint = from_asset(policy, "", 2)
  // Minting 2 tokens instead of 1
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, InlineDatum(0), None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "", 2),
          InlineDatum(initial_datum),
          None,
        ),
      ],
    }

  let ctx = ScriptContext(tx, 0, Minting(policy))

  reserve.reserve_forever.else(ctx)
}

test forever_mint_multiple_tokens_fail() fail {
  let mint = from_asset(policy, "", 1) |> add(policy, "yes", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, InlineDatum(0), None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "", 2),
          InlineDatum(initial_datum),
          None,
        ),
      ],
    }

  let ctx = ScriptContext(tx, 0, Minting(policy))

  reserve.reserve_forever.else(ctx)
}

test forever_mint_different_address_fail() fail {
  let different_policy =
    #"77777777777777777777777777777777777777777777777777777777"
  let different_script_address = Address(Script(different_policy), None)

  let mint = from_asset(policy, "", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, InlineDatum(0), None))],
      outputs: [
        Output(
          different_script_address,
          // Different script address
          from_lovelace(10000000) |> add(policy, "", 1),
          InlineDatum(initial_datum),
          None,
        ),
      ],
    }

  let ctx = ScriptContext(tx, 0, Minting(policy))

  reserve.reserve_forever.else(ctx)
}

test forever_mint_output_no_token_fail() fail {
  let mint = from_asset(policy, "", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, InlineDatum(0), None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000),
          // No token added to output
          InlineDatum(initial_datum),
          None,
        ),
      ],
    }

  let ctx = ScriptContext(tx, 0, Minting(policy))

  reserve.reserve_forever.else(ctx)
}

test forever_mint_missing_input_fail() fail {
  let mint = from_asset(policy, "", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [],
      // No inputs provided
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

test forever_mint_different_ref_fail() fail {
  let different_ref =
    OutputReference(
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      0,
    )

  let mint = from_asset(policy, "", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(different_ref, Output(address, val, InlineDatum(0), None))],
      // Different reference
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

test forever_spending_empty_mitigation() {
  let main_state_datum_empty_mitigation =
    UpgradeState(
      logic_script_hash,
      "",
      auth_script_hash,
      mitigation_auth_script_hash,
      0,
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

test forever_spending_missing_reference_input_fail() fail {
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
      reference_inputs: [],
      // No reference inputs provided
      withdrawals: [
        Pair(Script(logic_script_hash), 0),
        Pair(Script(mitigation_logic_script_hash), 0),
      ],
    }

  let ctx = ScriptContext(tx, 0, Spending(spending_out_ref, None))

  reserve.reserve_forever.else(ctx)
}

test forever_spending_wrong_token_in_reference_input_fail() fail {
  let wrong_policy = #"77777777777777777777777777777777777777777777777777777777"

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
            from_lovelace(10000000) |> add(wrong_policy, "main", 1),
            // Wrong token policy in reference input
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

test forever_spending_missing_withdrawal_fail() fail {
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
      withdrawals: [],
    }

  // No withdrawals provided
  let ctx = ScriptContext(tx, 0, Spending(spending_out_ref, None))

  reserve.reserve_forever.else(ctx)
}

test forever_spending_wrong_withdrawal_fail() fail {
  let wrong_script_hash =
    #"77777777777777777777777777777777777777777777777777777777"

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
        Pair(Script(wrong_script_hash), 0),
        // Wrong script hash in withdrawal
        Pair(Script(mitigation_logic_script_hash), 0),
      ],
    }

  let ctx = ScriptContext(tx, 0, Spending(spending_out_ref, None))

  reserve.reserve_forever.else(ctx)
}

test forever_spending_missing_withdrawal_with_mitigation_fail() fail {
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
      withdrawals: [Pair(Script(logic_script_hash), 0)],
    }

  // Missing mitigation withdrawal
  let ctx = ScriptContext(tx, 0, Spending(spending_out_ref, None))

  reserve.reserve_forever.else(ctx)
}

test forever_spending_wrong_withdrawal_with_empty_mitigation_fail() fail {
  let main_state_datum_empty_mitigation =
    UpgradeState(
      logic_script_hash,
      "",
      auth_script_hash,
      mitigation_auth_script_hash,
      0,
      0,
    )

  let wrong_script_hash =
    #"77777777777777777777777777777777777777777777777777777777"

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
      withdrawals: [Pair(Script(wrong_script_hash), 0)],
    }

  // Wrong script hash even with empty mitigation
  let ctx = ScriptContext(tx, 0, Spending(spending_out_ref, None))

  reserve.reserve_forever.else(ctx)
}

test reserve_logic_merge() {
  let forever_script_address =
    Address(Script(config.reserve_forever_hash), None)

  let input1_ref =
    OutputReference(
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      0,
    )

  let input2_ref =
    OutputReference(
      #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      1,
    )

  let withdrawal_ref =
    Script(#"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc")

  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          input1_ref,
          Output(
            forever_script_address,
            from_lovelace(5000000) |> add(config.cnight_policy, config.cnight_name, 100),
            InlineDatum(initial_datum),
            None,
          ),
        ),
        Input(
          input2_ref,
          Output(
            forever_script_address,
            from_lovelace(3000000) |> add(config.cnight_policy, config.cnight_name, 200),
            InlineDatum(initial_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          forever_script_address,
          from_lovelace(8000000) |> add(config.cnight_policy, config.cnight_name, 300),
          InlineDatum(initial_datum),
          None,
        ),
      ],
      withdrawals: [Pair(Script(logic_script_hash), 0)],
    }

  let ctx = ScriptContext(tx, 0, Withdrawing(withdrawal_ref))

  reserve.reserve_logic.else(ctx)
}

test reserve_logic_merge_unrelated_token_fail() fail {
  let forever_script_address =
    Address(Script(config.reserve_forever_hash), None)

  let unrelated_policy =
    #"77777777777777777777777777777777777777777777777777777777"

  let input1_ref =
    OutputReference(
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      0,
    )

  let input2_ref =
    OutputReference(
      #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      1,
    )

  let withdrawal_ref =
    Script(#"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc")

  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          input1_ref,
          Output(
            forever_script_address,
            from_lovelace(5000000) |> add(config.cnight_policy, config.cnight_name, 100),
            InlineDatum(initial_datum),
            None,
          ),
        ),
        Input(
          input2_ref,
          Output(
            forever_script_address,
            from_lovelace(3000000) |> add(config.cnight_policy, config.cnight_name, 200),
            InlineDatum(initial_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          forever_script_address,
          from_lovelace(8000000)
            |> add(config.cnight_policy, config.cnight_name, 300)
            |> add(unrelated_policy, "FAKE", 50),
          InlineDatum(initial_datum),
          None,
        ),
      ],
      withdrawals: [Pair(Script(logic_script_hash), 0)],
    }

  let ctx = ScriptContext(tx, 0, Withdrawing(withdrawal_ref))

  reserve.reserve_logic.else(ctx)
}

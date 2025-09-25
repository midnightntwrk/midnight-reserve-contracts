use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{add, from_asset, from_lovelace}
use cardano/script_context.{Minting, Spending}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Redeemer, Transaction,
  placeholder,
}
use config
use upgradable/two_stage_upgrade.{two_stage_upgradable}
use upgradable/types.{
  Auth, Logic, Main, MitigationAuth, Staging, TwoStageRedeemer, UpgradeState,
}

const policy = #"00000000000000000000000000000000000000000000000000000001"

const one_shot_ref =
  OutputReference(config.reserve_one_shot_hash, config.reserve_one_shot_index)

const address =
  Address(
    VerificationKey(#"11111111111111111111111111111111111111111111111111111111"),
    None,
  )

const script_address = Address(Script(policy), None)

const val = assets.zero

const main_datum =
  UpgradeState(
    #"33333333333333333333333333333333333333333333333333333333",
    "",
    #"44444444444444444444444444444444444444444444444444444444",
    "",
    0,
  )

const staging_datum =
  UpgradeState(
    #"55555555555555555555555555555555555555555555555555555555",
    "",
    #"66666666666666666666666666666666666666666666666666666666",
    "",
    0,
  )

const own_out_ref =
  OutputReference(
    #"87878787878787878787878787878787878787878787878787878787",
    4,
  )

const ref_input_out_ref =
  OutputReference(
    #"54545454545454545454545454545454545454545454545454545454",
    4,
  )

test mint() {
  let mint = from_asset(policy, "main", 1) |> add(policy, "staging", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(main_datum),
          None,
        ),
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(staging_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = 0

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_different_redeemer() {
  let mint = from_asset(policy, "main", 1) |> add(policy, "staging", 1)

  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(main_datum),
          None,
        ),
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(staging_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = Some(1)

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_main_only() fail {
  let mint = from_asset(policy, "main", 1)

  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(main_datum),
          None,
        ),
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(staging_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = Some(1)

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_staging_only() fail {
  let mint = from_asset(policy, "staging", 1)

  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(main_datum),
          None,
        ),
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(staging_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = Some(1)

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_no_main_output() fail {
  let mint = from_asset(policy, "main", 1) |> add(policy, "staging", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(staging_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = 0

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_no_staging_output() fail {
  let mint = from_asset(policy, "main", 1) |> add(policy, "staging", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(main_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = 0

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_mixed_output_order() fail {
  let mint = from_asset(policy, "main", 1) |> add(policy, "staging", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(staging_datum),
          None,
        ),
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(main_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = 0

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_nonconsecutive_outputs() fail {
  let mint = from_asset(policy, "main", 1) |> add(policy, "staging", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(main_datum),
          None,
        ),
        Output(address, from_lovelace(50000), InlineDatum(staging_datum), None),
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(staging_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = 0

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_output_missing_main_token() fail {
  let mint = from_asset(policy, "main", 1) |> add(policy, "staging", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000),
          InlineDatum(main_datum),
          None,
        ),
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(staging_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = 0

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test mint_output_missing_staging_token() fail {
  let mint = from_asset(policy, "main", 1) |> add(policy, "staging", 1)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(one_shot_ref, Output(address, val, NoDatum, None))],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(main_datum),
          None,
        ),
        Output(
          script_address,
          from_lovelace(10000000),
          InlineDatum(staging_datum),
          None,
        ),
      ],
    }

  let redeemer: Redeemer = 0

  let info = Minting(policy)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_logic_change() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_input_lacks_main_token() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_reference_input_missing() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_reference_input_missing_staging_token() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_output_to_different_address() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_output_missing_token() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_input_output_missing_token() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_output_logic_does_not_match_staging() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: main_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_output_round_does_not_match_staging() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: main_datum.round,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_withdrawals_missing() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_withdrawals_does_not_contain_main_auth() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Logic, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_logic_change() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_input_lacks_staging_token() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_reference_input_missing() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_reference_input_missing_main_token() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_output_to_different_address() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_output_missing_token() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_input_output_missing_token() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_output_logic_does_not_match_redeemer() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: staging_datum.logic,
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_output_round_not_incremented() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_output_round_incremented_twice() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_withdrawals_missing() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_withdrawals_does_not_contain_staging_auth() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [
        Pair(
          Script(#"51515151515151515151515151515151515151515151515151515151"),
          0,
        ),
      ],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_logic_change_w_main_auth() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_logic_change_w_mitigation() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState {
                ..staging_datum,
                logic: #"51515151515151515151515151515151515151515151515151515151",
                round: staging_datum.round,
                mitigation_auth: #"72727272727272727272727272727272727272727272727272727272",
              },
            ),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515151",
              round: staging_datum.round + 1,
              mitigation_auth: #"72727272727272727272727272727272727272727272727272727272",
            },
          ),
          None,
        ),
      ],
      withdrawals: [
        Pair(Script(staging_datum.auth), 0),
        Pair(
          Script(#"72727272727272727272727272727272727272727272727272727272"),
          0,
        ),
      ],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515151",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_logic_change_w_main_auth_ignore_staging_mitigation() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState {
                ..staging_datum,
                logic: #"51515151515151515151515151515151515151515151515151515151",
                round: staging_datum.round,
                mitigation_auth: #"72727272727272727272727272727272727272727272727272727272",
              },
            ),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515152",
              round: staging_datum.round + 1,
              mitigation_auth: #"72727272727272727272727272727272727272727272727272727272",
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515152",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_logic_change_missing_staging_mitigation() fail {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState {
                ..staging_datum,
                logic: #"51515151515151515151515151515151515151515151515151515151",
                round: staging_datum.round,
                mitigation_auth: #"72727272727272727272727272727272727272727272727272727272",
              },
            ),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              logic: #"51515151515151515151515151515151515151515151515151515152",
              round: staging_datum.round + 1,
              mitigation_auth: #"72727272727272727272727272727272727272727272727272727272",
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Logic,
      Staging(
        ref_input_out_ref,
        #"51515151515151515151515151515151515151515151515151515152",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_auth_change() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState { ..staging_datum, round: staging_datum.round + 2 },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              auth: staging_datum.auth,
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer = TwoStageRedeemer(Auth, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_auth_change() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              auth: #"29292929292929292929292929292929292929292929292929292929",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      Auth,
      Staging(
        ref_input_out_ref,
        #"29292929292929292929292929292929292929292929292929292929",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_main_mitigation_auth_change() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(
              UpgradeState {
                ..staging_datum,
                mitigation_auth: #"28282828282828282828282828282828282828282828282828282828",
                round: staging_datum.round + 2,
              },
            ),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "main", 1),
          InlineDatum(
            UpgradeState {
              ..main_datum,
              mitigation_auth: #"28282828282828282828282828282828282828282828282828282828",
              round: staging_datum.round + 2,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(main_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(MitigationAuth, Main(ref_input_out_ref))

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

test spending_staging_mitigation_auth_change() {
  let tx =
    Transaction {
      ..placeholder,
      inputs: [
        Input(
          own_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "staging", 1),
            InlineDatum(staging_datum),
            None,
          ),
        ),
      ],
      reference_inputs: [
        Input(
          ref_input_out_ref,
          Output(
            script_address,
            from_lovelace(10000000) |> add(policy, "main", 1),
            InlineDatum(main_datum),
            None,
          ),
        ),
      ],
      outputs: [
        Output(
          script_address,
          from_lovelace(10000000) |> add(policy, "staging", 1),
          InlineDatum(
            UpgradeState {
              ..staging_datum,
              mitigation_auth: #"28282828282828282828282828282828282828282828282828282828",
              round: staging_datum.round + 1,
            },
          ),
          None,
        ),
      ],
      withdrawals: [Pair(Script(staging_datum.auth), 0)],
    }

  let redeemer: Redeemer =
    TwoStageRedeemer(
      MitigationAuth,
      Staging(
        ref_input_out_ref,
        #"28282828282828282828282828282828282828282828282828282828",
      ),
    )

  let info = Spending(own_out_ref, None)

  two_stage_upgradable(tx, redeemer, info, one_shot_ref)
}

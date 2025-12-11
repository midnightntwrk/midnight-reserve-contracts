use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use logic/script.{logic_merge} as logic_script
use upgradable/two_stage_upgrade.{two_stage_upgradable}

fn reserve_init_validation(_datum: Data, _redeemer: Redeemer) {
  // (RV-1) Reserve bootstrap transactions rely solely on the forever helper; no extra datum or redeemer checks apply.
  True
}

validator reserve_forever {
  else(ctx: ScriptContext) {
    // (RF-1) Read the configured reserve one-shot UTXO that must be consumed to mint the forever NFT.
    let one_shot_ref =
      OutputReference(
        config.reserve_one_shot_hash,
        config.reserve_one_shot_index,
      )

    // (RF-2) Delegate to the forever helper (FC-1, FC-2, FC-3, FC-4, FC-5, FC-6, FC-7, FC-8, FC-9).
    forever_contract(
      ctx,
      one_shot_ref,
      config.reserve_two_stage_hash,
      reserve_init_validation,
    )
  }
}

validator reserve_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    // (RU-2) Rebuild the reserve one-shot reference that authorises progression between staging and main states.
    let one_shot_ref =
      OutputReference(
        config.reserve_one_shot_hash,
        config.reserve_one_shot_index,
      )

    // (RU-3) Apply the shared two-stage checks (TS-1, TS-2, TS-3, TS-4, TS-5, TS-6, TS-7, TS-8,
    //        TSM-1, TSM-2, TSM-3, TSM-4, TSM-5, TSM-6, TSM-7, TSM-8, TSM-9, TSM-10, TSM-11, TSM-12,
    //        TSM-13, TSM-14, TSM-15, TSM-16, TSM-17, TSM-18, TSS-1, TSS-2, TSS-3, TM-1, TM-2, TM-3,
    //        TM-4, TM-5, TM-6, TM-7, TM-8, TSG-1, TSG-2, TSG-3, TSG-4, TSG-5, TSG-6, TSG-7, TSG-8,
    //        RUN-1, RUN-2, RUN-3).
    two_stage_upgradable(transaction, redeemer, info, one_shot_ref)
  }
}

validator reserve_logic {
  else(ctx: ScriptContext) {
    // (RL-1) Access the transaction and script info necessary to analyse reserve withdrawals.
    let ScriptContext { transaction, info, .. } = ctx

    // (RL-2) Delegate to logic merge (LM-0, LM-1, LM-2, LM-3, LM-4).
    logic_merge(transaction, info, config.reserve_forever_hash)
  }
}

//// Rewards pool triple (spec §9), cloned from `reserve.ak`. The forever
//// NFT datum is reserved (init validation is a no-op). Governance sets the
//// `mitigation_logic` of the main datum; it is `""` at deployment, as the
//// reserve's is on mainnet.

use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/script.{forever_contract}
use rewards/pool.{pool_logic}
use upgradable/two_stage_upgrade.{two_stage_upgradable}

fn pool_init_validation(_datum: Data, _redeemer: Redeemer) {
  True
}

const pool_one_shot_ref =
  OutputReference(
    config.rewards_pool_one_shot_hash,
    config.rewards_pool_one_shot_index,
  )

/// One-shot forever NFT; value UTXOs at this address hold `[ada, night]`.
validator rewards_pool_forever {
  else(ctx: ScriptContext) {
    forever_contract(
      ctx,
      pool_one_shot_ref,
      config.rewards_pool_two_stage_hash,
      pool_init_validation,
    )
  }
}

validator rewards_pool_two_stage_upgrade {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    two_stage_upgradable(transaction, redeemer, info, pool_one_shot_ref)
  }
}

/// `Receive` merge and `Disburse` (batcher withdrawal); staging state NFT mint.
validator rewards_pool_logic {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    pool_logic(
      transaction,
      info,
      redeemer,
      config.rewards_pool_two_stage_hash,
      OutputReference(
        config.rewards_pool_logic_one_shot_hash,
        config.rewards_pool_logic_one_shot_index,
      ),
    )
  }
}

//// Staging-track forever NFT of the rewards pool; mirrors
//// `staging_reserve_ics.ak` so a release can be rehearsed with test tokens.

use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference, Redeemer}
use config
use forever/staging.{staging_forever_contract}

fn pool_init_validation(_datum: Data, _redeemer: Redeemer) {
  True
}

validator rewards_pool_staging_forever {
  else(ctx: ScriptContext) {
    staging_forever_contract(
      ctx,
      OutputReference(
        config.rewards_pool_staging_one_shot_hash,
        config.rewards_pool_staging_one_shot_index,
      ),
      config.rewards_pool_two_stage_hash,
      pool_init_validation,
    )
  }
}

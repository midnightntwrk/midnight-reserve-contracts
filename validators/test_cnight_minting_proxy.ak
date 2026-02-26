use aiken/collection/list
use cardano/address.{Script}
use cardano/script_context.{Minting, ScriptContext}
use cardano/transaction.{Transaction}
use config

/// Test-only minting validator that depends on cnight_mint_forever withdrawal.
/// Proves the full proxy chain: minting → forever withdrawal → logic withdrawal.
validator test_cnight_minting_proxy {
  else(ctx: ScriptContext) {
    when ctx.info is {
      Minting(_) -> {
        let Transaction { withdrawals, .. } = ctx.transaction
        let forever_cred = Script(config.cnight_minting_forever_hash)
        list.any(withdrawals, fn(w) { w.1st == forever_cred })
      }
      _ -> fail
    }
  }
}

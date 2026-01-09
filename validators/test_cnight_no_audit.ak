use aiken/builtin
use cardano/script_context.{ScriptContext}

/// This set of validators is purely for testnet no audit is necessary.
/// Real funds are not used via this contract
/// This contract mints any amount of night for testing
validator tcnight_mint_infinite {
  else(ctx: ScriptContext) {
    ( ctx.redeemer |> builtin.serialise_data |> builtin.blake2b_256 ) != ""
  }
}

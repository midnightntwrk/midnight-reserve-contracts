use cardano/script_context.{ScriptContext}

/// Enforces no Night tokens can be minted
validator cnight_mint_logic_v2 {
  else(_ctx: ScriptContext) {
    fail
  }
}

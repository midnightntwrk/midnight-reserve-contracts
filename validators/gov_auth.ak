use auth/script.{auth_multisig_validation}
use auth/staging.{staging_auth_multisig_validation}
use cardano/script_context.{ScriptContext}

/// Authorizes promote-upgrade and main state changes via withdrawal.
validator main_gov_auth {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    auth_multisig_validation(transaction, info)
  }
}

/// Authorizes stage-upgrade operations via withdrawal.
validator staging_gov_auth {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    staging_auth_multisig_validation(transaction, info)
  }
}

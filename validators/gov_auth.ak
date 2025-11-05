use auth/script.{auth_multisig_validation}
use auth/staging.{staging_auth_multisig_validation}
use cardano/script_context.{ScriptContext}

validator main_gov_auth {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    // (GAV-1) Delegate to the main governance multisig helper.
    auth_multisig_validation(transaction, info)
  }
}

validator staging_gov_auth {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    // (GAVS-1) Delegate to the staging governance multisig helper.
    staging_auth_multisig_validation(transaction, info)
  }
}

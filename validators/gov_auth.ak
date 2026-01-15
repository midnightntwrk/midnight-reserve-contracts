use auth/script.{auth_multisig_validation}
use auth/staging.{staging_auth_multisig_validation}
use cardano/script_context.{ScriptContext}

/// Main governance authorization validator: validates multisig authorization for main governance operations.
/// Used via withdrawal to authorize promote-upgrade and other main state changes.
validator main_gov_auth {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    auth_multisig_validation(transaction, info)
  }
}

/// Staging governance authorization validator: validates multisig authorization for staging governance operations.
/// Used via withdrawal to authorize stage-upgrade operations.
validator staging_gov_auth {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, info, .. } = ctx
    staging_auth_multisig_validation(transaction, info)
  }
}

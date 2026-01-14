/// Always Fails Validator
///
/// This validator always returns False, used for testing abort/downgrade scenarios
/// in the two-stage upgrade system.
///
/// When staged to an UpgradeState, any operation attempting to use this logic
/// will fail validation.

use cardano/script_context.{ScriptInfo}
use cardano/transaction.{Redeemer, Transaction}

validator always_fails {
  spend(_datum: Option<Data>, _redeemer, _output, _tx) {
    False
  }

  else(_) {
    False
  }
}

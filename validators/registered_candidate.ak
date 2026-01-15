use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/script_context.{ScriptContext, Spending}
use cardano/transaction.{Transaction}

/// Allows spending only when datum's verification key hash is in extra signatories.
validator registered_candidate {
  else(ctx: ScriptContext) {
    let ScriptContext { info, transaction, .. } = ctx

    let Transaction { extra_signatories, .. } = transaction

    when info is {
      Spending { datum, .. } -> {
        expect Some(datum) = datum

        expect pkh: VerificationKeyHash = datum

        list.has(extra_signatories, pkh)
      }
      _ -> fail
    }
  }
}

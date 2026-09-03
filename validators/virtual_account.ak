use cardano/address.{Script}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, Spending, Withdrawing,
}
use rewards/account.{account_gate, account_withdraw}
use utils.{must_find}

/// Deposit list and registration records (spec §3, §4); user logic runs in the withdraw handler.
validator virtual_account {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    when info is {
      Minting(own_policy) ->
        account_gate(transaction.withdrawals, own_policy, redeemer)
      Spending { output: own_ref, .. } -> {
        let own_input =
          must_find(transaction.inputs, fn(i) { i.output_reference == own_ref })
        expect Script(own_hash) = own_input.output.address.payment_credential
        account_gate(transaction.withdrawals, own_hash, redeemer)
      }
      Withdrawing(Script(own_hash)) ->
        account_withdraw(transaction, own_hash, redeemer)
      Publishing { certificate: RegisterCredential { .. }, .. } -> True
      _ -> fail
    }
  }
}

use cardano/address.{Script}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, Spending, Withdrawing,
}
use cardano/transaction.{OutputReference}
use config
use rewards/batch.{init_state, spend_gate, validate}
use utils.{must_find}

/// Batch payouts and exits (spec §5); all logic runs once per tx in the withdraw handler.
validator rewards_batcher {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx
    when info is {
      Minting(own_policy) ->
        init_state(
          transaction,
          own_policy,
          OutputReference(
            config.rewards_batcher_one_shot_hash,
            config.rewards_batcher_one_shot_index,
          ),
        )
      Spending { output: own_ref, .. } -> {
        let own_input =
          must_find(transaction.inputs, fn(i) { i.output_reference == own_ref })
        expect Script(own_hash) = own_input.output.address.payment_credential
        spend_gate(transaction.withdrawals, own_hash)
      }
      Withdrawing(Script(own_hash)) -> validate(transaction, own_hash, redeemer)
      Publishing { certificate: RegisterCredential { .. }, .. } -> True
      _ -> fail
    }
  }
}

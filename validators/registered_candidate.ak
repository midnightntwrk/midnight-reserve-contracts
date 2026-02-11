use aiken/builtin
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/script_context.{ScriptContext, Spending}
use cardano/transaction.{Transaction}
use config

@list
pub type CandidateDatum {
  data: VerificationKeyHash,
  appendix: Data,
  logic_round: Int,
}

/// Allows spending only when datum's verification key hash is in extra signatories.
validator registered_candidate {
  else(ctx: ScriptContext) {
    let ScriptContext { info, transaction, .. } = ctx

    let Transaction { extra_signatories, .. } = transaction

    when info is {
      Spending { datum, .. } -> {
        expect Some(datum) = datum

        let value = builtin.serialise_data(info)

        expect CandidateDatum { data: pkh, .. }: CandidateDatum = datum

        and {
          list.has(extra_signatories, pkh),
          value != config.cnight_policy,
          value != config.candidate_nonce,
        }
      }

      _ -> fail
    }
  }
}

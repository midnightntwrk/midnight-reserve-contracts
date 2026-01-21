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
// V1 {
// 		/// Stake ownership information of registered candidate.
// 		stake_ownership: AdaBasedStaking,
// 		/// Sidechain public key of the candidate. See [SidechainPublicKey] for more details.
// 		sidechain_pub_key: SidechainPublicKey,
// 		/// Sidechain key signature of the registration message.
// 		sidechain_signature: SidechainSignature,
// 		/// UTxO id that is a part of the signed registration message.
// 		/// It is spent during the registration process. Prevents replay attacks.
// 		registration_utxo: UtxoId,
// 		/// Hash of the registering SPO's Cardano public key.
// 		/// Used by offchain code to find the registration UTXO when re-registering or de-registering.
// 		own_pkh: MainchainKeyHash,
// 		/// Additional keys of the registered candidate, these are specific to the keys used by the partner chain
// 		keys: CandidateKeys,
// 	},

// stake_ownership: AdaBasedStaking {
// 				pub_key: self.spo_public_key.clone(),
// 				signature: self.spo_signature.clone(),
// 			},

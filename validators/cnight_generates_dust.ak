use aiken/builtin
use aiken/collection/list
use cardano/address.{Credential, Script, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use utils.{one_shot_mint}

pub type DustMappingDatum {
  // Address of wallet to register for Dust production
  c_wallet: Credential,
  // DUST address on Midnight to accumulate produced DUST
  dust_address: ByteArray,
}

pub type DustAction {
  Create
  Burn
}

validator cnight_generates_dust {
  mint(redeemer: DustAction, own_policy: PolicyId, transaction: Transaction) {
    let Transaction {
      inputs,
      outputs,
      mint,
      extra_signatories,
      withdrawals,
      ..
    } = transaction

    when redeemer is {
      Create -> {
        expect [input, ..] = inputs

        let output_datum =
          one_shot_mint(
            inputs,
            mint,
            outputs,
            own_policy,
            input.output_reference,
          )

        expect DustMappingDatum { c_wallet, dust_address } = output_datum

        // TODO: How long is Midnight Address?
        expect builtin.length_of_bytearray(dust_address) > 0

        when c_wallet is {
          VerificationKey(key) -> list.has(extra_signatories, key)
          Script(_) as script ->
            list.any(withdrawals, fn(withdraw) { withdraw.1st == script })
        }
      }

      Burn -> todo
    }
  }

  spend(
    datum: Option<DustMappingDatum>,
    redeemer,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    todo
  }

  else(_) {
    fail
  }
}

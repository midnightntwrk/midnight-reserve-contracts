//// Funding pool rules, MIP 12–17 (spec §7), run by `committee_bridge_logic`
//// after a valid update.

use aiken/collection/list
use aiken/crypto.{ScriptHash}
use bridge/types.{BeefyThreshold}
use cardano/address.{Address, Script}
use cardano/assets.{lovelace_of, without_lovelace, zero}
use cardano/transaction.{Input, NoDatum, Transaction}

/// MIP rules 12–17: with pool inputs present, output 1 is the bare lovelace-only pool output, and a positive debit only for a handover within `fee` and `cap = base + per_signer × signers`.
pub fn check_pool(
  tx: Transaction,
  pool: ScriptHash,
  threshold: BeefyThreshold,
  handover: Bool,
  signers: Int,
) -> Bool {
  let Transaction { inputs, outputs, fee, .. } = tx
  let credential = Script(pool)

  let pool_in =
    list.foldl(
      inputs,
      0,
      fn(input: Input, acc) {
        if input.output.address.payment_credential == credential {
          acc + lovelace_of(input.output.value)
        } else {
          acc
        }
      },
    )

  if pool_in == 0 {
    True
  } else {
    expect [_, pool_output, ..] = outputs
    expect pool_output.address == Address(credential, None)
    expect without_lovelace(pool_output.value) == zero
    expect pool_output.datum == NoDatum

    let debit = pool_in - lovelace_of(pool_output.value)

    or {
      debit <= 0,
      and {
        handover,
        debit <= fee,
        debit <= threshold.base + threshold.per_signer * signers,
      },
    }
  }
}

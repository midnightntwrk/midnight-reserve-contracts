//// Stake credential authorization shared by every user path.

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Credential, Script, VerificationKey}

/// VerificationKey: hash in extra_signatories. Script: a withdrawal from that credential exists.
pub fn stake_auth(
  cred: Credential,
  extra_signatories: List<VerificationKeyHash>,
  withdrawals: Pairs<Credential, Int>,
) -> Bool {
  when cred is {
    VerificationKey(key) -> list.has(extra_signatories, key)
    Script(_) -> list.any(withdrawals, fn(w) { w.1st == cred })
  }
}

const key_a = #"00000000000000000000000000000000000000000000000000000000"

const key_b = #"01010101010101010101010101010101010101010101010101010101"

test stake_auth_key_present() {
  stake_auth(VerificationKey(key_a), [key_b, key_a], [])
}

test stake_auth_key_absent() fail {
  stake_auth(VerificationKey(key_a), [key_b], [Pair(Script(key_a), 0)])
}

test stake_auth_script_present() {
  stake_auth(
    Script(key_a),
    [],
    [Pair(Script(key_b), 0), Pair(Script(key_a), 0)],
  )
}

test stake_auth_script_absent() fail {
  stake_auth(Script(key_a), [key_a], [Pair(VerificationKey(key_a), 0)])
}

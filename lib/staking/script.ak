use aiken/collection/dict.{to_pairs}
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Credential, Script, VerificationKey}
use cardano/assets.{PolicyId, to_dict}
use cardano/transaction.{Output}
use utils_v2.{find_key, has, has_key}

/// Validates authorization by a credential: verification keys must sign, scripts must
/// appear in withdrawals. The same rule as cnight_generates_dust's check_auth.
pub fn check_auth(
  credential: Credential,
  extra_signatories: List<VerificationKeyHash>,
  withdrawals: Pairs<Credential, Int>,
) -> Bool {
  when credential is {
    VerificationKey(key) -> has(extra_signatories, key)

    Script(_) as script -> has_key(withdrawals, script)
  }
}

/// Validates that no output sits at the script's address or carries a token of its policy.
/// Night_staking and night_registration check it on every output after the ones a
/// transaction's shape places at the address.
pub fn no_script_output(outputs: List<Output>, own_hash: PolicyId) -> Bool {
  when outputs is {
    [] -> True
    [output, ..rest] -> {
      expect output.address.payment_credential != Script(own_hash)

      expect None = find_key(output.value |> to_dict |> to_pairs, own_hash)

      no_script_output(rest, own_hash)
    }
  }
}

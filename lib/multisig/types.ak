use aiken/crypto.{ScriptHash}

@list
pub type Multisig {
  total_signers: Int,
  min_signers: Int,
  signers: Data<List<NativeScriptSigner>>,
}

pub type NativeScript =
  ByteArray

/// A signer pubkey hash plus extra bytes
/// in front to be a native script signer
/// #8200581C will be enforced to preprend each pubkey hash
pub type NativeScriptSigner =
  ByteArray

pub type MultisigPolicy {
  signer_state: ScriptHash,
  threshold_numerator: Int,
  threshold_denominator: Int,
}

pub type MultisigPolicies =
  List<MultisigPolicy>

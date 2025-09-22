@list
pub type Multisig {
  total_signers: Int,
  signers: Data<List<NativeScriptSigner>>,
}

pub type NativeScript =
  ByteArray

/// A signer pubkey hash plus extra bytes
/// in front to be a native script signer
/// #8200581C will be enforced to preprend each pubkey hash
pub type NativeScriptSigner =
  ByteArray

pub type MainMultisigThreshold {
  technical_auth_numerator: Int,
  technical_auth_denominator: Int,
  council_numerator: Int,
  council_denominator: Int,
}

pub type StagingMultisigThreshold {
  technical_auth_numerator: Int,
  technical_auth_denominator: Int,
}

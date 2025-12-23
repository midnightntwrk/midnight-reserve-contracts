@list
pub type Multisig {
  total_signers: Int,
  signers: Data<Pairs<NativeScriptSigner, Sr25519PubKey>>,
}

/// length is  32
pub type Sr25519PubKey =
  ByteArray

pub type NativeScript =
  ByteArray

/// A signer pubkey hash plus extra bytes
/// in front to be a native script signer
/// #8200581C will be enforced to preprend each pubkey hash
/// total length is 32 bytes
pub type NativeScriptSigner =
  ByteArray

@list
pub type MultisigThreshold {
  technical_auth_numerator: Int,
  technical_auth_denominator: Int,
  council_numerator: Int,
  council_denominator: Int,
}

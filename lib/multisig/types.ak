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
pub type NativeScriptSigner =
  ByteArray

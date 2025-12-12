@list
pub type Versioned<a> {
  data: a,
  round: Int,
}

@list
pub type TermsAndConditions {
  hash: ByteArray,
  link: ByteArray,
}

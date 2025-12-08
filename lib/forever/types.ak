pub type Versioned<a> {
  data: a,
  round: Int,
}

pub type TermsAndConditions {
  hash: ByteArray,
  link: ByteArray,
}

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

// 121([]) -> 0 []
pub type Unit {
  Unit
}

@list
pub type CandidateKey {
  id: ByteArray,
  bytes: ByteArray,
}

pub type SidechainPublicKey =
  ByteArray

@list
pub type PermissionedCandidateDatumV1 {
  // Partner Chains key identifier and bytes
  partner_chains_key: SidechainPublicKey,
  // Represents arbitrary set of keys with 4 character identifier
  keys: List<CandidateKey>,
}

@list
pub type FederatedOps {
  data: Data,
  appendix: List<PermissionedCandidateDatumV1>,
  version: Int,
}
// 4 bytes
// key:  [#"bytes", #"bytes"]

// [
//   0 [],
//   [
//     [#"bytes", [key1, key2]]
//   ],
//   2
// ]

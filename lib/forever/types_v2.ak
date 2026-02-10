use forever/types.{PermissionedCandidateDatumV1}

/// FederatedOpsV2 adds a `message` field compared to FederatedOps v1.
/// Used after migration from v1 datum. Expects logic_round: 2.
@list
pub type FederatedOpsV2 {
  data: Data,
  message: ByteArray,
  appendix: List<PermissionedCandidateDatumV1>,
  logic_round: Int,
}

use forever/types_v2.{FederatedOpsV2}

validator z_federated_ops_v2_types {
  spend(_datum: Option<FederatedOpsV2>, _redeemer, _output, _tx) {
    fail
  }

  else(_) {
    fail
  }
}

use cardano/transaction.{Transaction}

// Simple minting policy that always succeeds
// This allows minting any amount of any token
validator simple_mint {
  mint(_redeemer: Void, _policy_id: ByteArray, _tx: Transaction) {
    True
  }
}

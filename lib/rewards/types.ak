//// Datums and redeemers for the block production rewards contracts.
////
//// Constructor order is part of the blueprint contract: off-chain code
//// addresses constructors by index. Add new constructors at the end only.
//// Field layouts follow docs/rewards/spec.md §3, §4.1, §5.1, §5.3, §7,
//// §8.1 and §9.

use aiken/crypto.{ScriptHash}
use bridge/types.{BeefyMmrLeaf, ProofNodeRec}
use cardano/address.{Address, Credential}
use cardano/assets.{PolicyId}

/// Key of the tail sentinel node; every real skh sorts below it.
pub const tail_key = #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

/// One datum per list NFT: head `""`, deposit `0x00 ++ skh`, registration `0x01 ++ skh`, tail `0x00 ++ tail_key`.
pub type AccountDatum {
  Head { next: ByteArray }
  Deposit { cred: Credential, next: ByteArray, committed: Option<Address> }
  Registration {
    owner: Credential,
    dust_address: ByteArray,
    validator_keys: ByteArray,
    spo_intent: Bool,
  }
  Tail
}

/// Spend and mint redeemer: which withdrawal validates this UTXO.
pub type AccountGate {
  User
  Batcher
}

/// Withdraw redeemer: one kind of user action, applied to every account-address
/// input; outputs from `offset` match those inputs 1:1 in ledger order.
pub type AccountAction {
  kind: ActionKind,
  offset: Int,
}

pub type ActionKind {
  InitList
  Register
  Withdraw
  TopUp
  SetDeregister
  UpdateRegistration
}

/// Inline datum on the batcher state NFT UTXO.
pub type BatcherState {
  account_policy: PolicyId,
  pool_forever: ScriptHash,
  epoch: Int,
  root: ByteArray,
  min_key: ByteArray,
  max_key: ByteArray,
  start_key: ByteArray,
  cursor: ByteArray,
  complete: Bool,
}

/// `LoadAndPay` opens an epoch with its first batch; `Pay` continues it.
pub type BatcherRedeemer {
  Pay { proof: ProofNodeRec, pairs: List<PayPair>, exits: List<ExitInfo> }
  LoadAndPay {
    digest_proof: DigestProof,
    proof: ProofNodeRec,
    pairs: List<PayPair>,
    exits: List<ExitInfo>,
  }
}

/// Deposit input/output indices for one paid leaf.
pub type PayPair {
  input_index: Int,
  output_index: Int,
}

/// Predecessor and refund indices for one exiting leaf.
pub type ExitInfo {
  pred_input_index: Int,
  pred_output_index: Int,
  refund_output_index: Int,
}

/// Positional MMR proof of a BEEFY leaf plus the SCALE header it commits to.
pub type DigestProof {
  leaf: BeefyMmrLeaf,
  leaf_index: Int,
  leaf_count: Int,
  items: List<ByteArray>,
  header: ByteArray,
  log_index: Int,
}

/// Per-epoch rewards digest decoded from the `MNRW` consensus log.
pub type Digest {
  epoch: Int,
  leaf_count: Int,
  root: ByteArray,
  min_key: ByteArray,
  max_key: ByteArray,
}

pub type ReserveRedeemer {
  Merge
  Release { intervals: Int }
}

/// Inline datum on the reserve forever NFT UTXO after the first release.
pub type ReleaseState {
  last_release_time: Int,
  next_amount: Int,
}

/// Staging-track hashes read from the reserve logic v2 NFT input.
pub type StagingStateV2 {
  cnight_test_policy: PolicyId,
  forever_script_hash: PolicyId,
  pool_forever_hash: PolicyId,
}

pub type PoolRedeemer {
  Receive
  Disburse
}

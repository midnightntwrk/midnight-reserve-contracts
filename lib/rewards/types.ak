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
/// `destinations`: `kind_byte ++ address -> weight`; weights > 0 and sum to 1000. `operator_keys`: opaque, node-owned.
/// `payout_threshold`: STAR above the distribution fee at which Midnight puts the account in a tree; ≥ 0.
pub type AccountDatum {
  Head { next: ByteArray }
  Deposit { cred: Credential, next: ByteArray, committed: Option<Address> }
  Registration {
    owner: Credential,
    destinations: Pairs<ByteArray, Int>,
    operator_keys: Pairs<ByteArray, ByteArray>,
    payout_threshold: Int,
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

/// Inline datum on the batcher state NFT UTXO. `cursor` is the last key paid
/// in the epoch, empty after the load; it is read only while
/// `complete == False`.
pub type BatcherState {
  account_policy: PolicyId,
  pool_forever: ScriptHash,
  epoch: Int,
  root: ByteArray,
  min_key: ByteArray,
  max_key: ByteArray,
  cursor: ByteArray,
  complete: Bool,
}

/// `Load` takes the next epoch's digest and pays its Treasury share; `Pay` pays one run of its leaves.
pub type BatcherRedeemer {
  Pay { proof: ProofNodeRec }
  Load { digest_proof: DigestProof }
}

/// MMR proof of a BEEFY leaf, the SCALE header it commits to, and the
/// `extrinsics_root` trie proof of the rewards extrinsic in that block. The
/// leaf index is the leaf's `parent_number`; the leaf count is the bridge's
/// `latest_height` (bridge spec §13).
pub type DigestProof {
  leaf: BeefyMmrLeaf,
  items: List<ByteArray>,
  header: ByteArray,
  extrinsic_index: Int,
  trie_nodes: List<ByteArray>,
  extrinsic: ByteArray,
}

/// Per-epoch rewards digest decoded from the `submit_rewards_digest` extrinsic.
pub type Digest {
  epoch: Int,
  leaf_count: Int,
  root: ByteArray,
  min_key: ByteArray,
  max_key: ByteArray,
  treasury_total: Int,
}

pub type ReserveRedeemer {
  Merge
  Release { intervals: Int }
}

/// Inline datum on the reserve forever NFT UTXO after the first release; before it the NFT holds the deploy datum `Constr 0 [0, 0]`.
pub type ReleaseState {
  last_release_time: Int,
  reserve_floor: Int,
}

/// Staging-track hashes read from the reserve logic v2 NFT input: `StagingState` plus the staging pool forever.
@list
pub type StagingStateV2 {
  cnight_test_policy: PolicyId,
  forever_script_hash: PolicyId,
  pool_forever_hash: PolicyId,
}

pub type PoolRedeemer {
  Receive
  Disburse
}

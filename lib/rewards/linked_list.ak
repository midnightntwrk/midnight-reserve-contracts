//// Sorted on-chain linked list of deposit nodes keyed by stake key hash.
//// Every node lives at the `virtual_account` address and carries one NFT
//// under its policy. Callers pass the indexed input/output pairs; nothing
//// here searches the transaction.

use aiken/builtin
use aiken/collection/list
use cardano/address.{Credential, Script}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference}
use rewards/types.{AccountDatum, Deposit, Head, Tail, tail_key}
use rewards/value.{only_nft, split_ada, tokens_of}

/// 28-byte hash of a stake credential: first field of either constructor.
pub fn key(cred: Credential) -> ByteArray {
  cred
    |> builtin.un_constr_data
    |> builtin.snd_pair
    |> builtin.head_list
    |> builtin.un_b_data
}

pub fn deposit_name(skh: ByteArray) -> AssetName {
  builtin.append_bytearray(#"00", skh)
}

pub fn registration_name(skh: ByteArray) -> AssetName {
  builtin.append_bytearray(#"01", skh)
}

/// Consume the one-shot ref, mint head and tail NFTs, create both nodes as `head` and `tail`.
pub fn init_list(
  inputs: List<Input>,
  mint: Value,
  head: Output,
  tail: Output,
  own_policy: PolicyId,
  one_shot_ref: OutputReference,
) -> Bool {
  expect list.any(inputs, fn(i) { i.output_reference == one_shot_ref })
  let tail_name = deposit_name(tail_key)
  expect [Pair("", 1), Pair(minted_tail, 1)] = tokens_of(mint, own_policy)
  expect minted_tail == tail_name
  let own_address = Script(own_policy)
  let (_, head_assets) = split_ada(head.value)
  let (_, tail_assets) = split_ada(tail.value)
  and {
    head.address.payment_credential == own_address,
    head_assets == only_nft(own_policy, ""),
    head.datum == InlineDatum(Head { next: tail_key }),
    tail.address.payment_credential == own_address,
    tail_assets == only_nft(own_policy, tail_name),
    tail.datum == InlineDatum(Tail),
  }
}

/// Link `node` after `anchor`; returns the new node's credential. Value of `node` is the caller's.
pub fn insert_ascending(
  anchor: Input,
  anchor_out: Output,
  node: Output,
  own_policy: PolicyId,
) -> Credential {
  expect InlineDatum(node_datum) = node.datum
  expect Deposit { cred, next: node_next, committed: None }: AccountDatum =
    node_datum
  let new_key = key(cred)
  let (anchor_key, anchor_next, anchor_datum) = node_of(anchor, own_policy)
  expect builtin.less_than_bytearray(anchor_key, new_key)
  expect builtin.less_than_bytearray(new_key, anchor_next)
  expect node_next == anchor_next
  expect node.address.payment_credential == Script(own_policy)
  expect and {
      anchor_out.address == anchor.output.address,
      anchor_out.value == anchor.output.value,
      anchor_out.datum == InlineDatum(with_next(anchor_datum, new_key)),
    }
  cred
}

/// `pred` (whose `next == removed_key`) continues as `pred_out` with `next = removed_next`.
pub fn unlink(
  pred: Input,
  pred_out: Output,
  own_policy: PolicyId,
  removed_key: ByteArray,
  removed_next: ByteArray,
) -> Bool {
  let (_, pred_next, pred_datum) = node_of(pred, own_policy)
  expect pred_next == removed_key
  and {
    pred_out.address == pred.output.address,
    pred_out.value == pred.output.value,
    pred_out.datum == InlineDatum(with_next(pred_datum, removed_next)),
  }
}

/// A head or deposit input identified by its NFT: (key, next, datum).
/// The head's key is "" so every real key sorts after it.
fn node_of(
  input: Input,
  own_policy: PolicyId,
) -> (ByteArray, ByteArray, AccountDatum) {
  expect [Pair(name, 1)] = tokens_of(input.output.value, own_policy)
  expect InlineDatum(datum) = input.output.datum
  expect datum: AccountDatum = datum
  if name == "" {
    expect Head { next } = datum
    ("", next, datum)
  } else {
    expect Deposit { cred, next, .. } = datum
    let node_key = key(cred)
    expect name == deposit_name(node_key)
    (node_key, next, datum)
  }
}

fn with_next(datum: AccountDatum, new_next: ByteArray) -> AccountDatum {
  when datum is {
    Head { .. } -> Head { next: new_next }
    Deposit { cred, committed, .. } ->
      Deposit { cred, next: new_next, committed }
    _ -> fail
  }
}

// Unit tests for night_registration: rules 9 and 10 of the staking MIP (PR 421) as the
// user's decisions change them, transaction by transaction (diagrams 6 to 9).

use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Address, Credential, Inline, Script, VerificationKey}
use cardano/assets.{Value}
use cardano/certificate.{
  AlwaysAbstain, DelegateBlockProduction, DelegateBoth, DelegateCredential,
  DelegateVote, RegisterAndDelegateCredential, RegisterCredential,
  UnregisterCredential,
}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, ScriptInfo, Spending, Withdrawing,
}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, ScriptPurpose,
  Transaction, Withdraw, placeholder,
}
use config
use night_registration
use registration/types.{
  CreateOneAnchor, CreateTwoAnchors, Deactivate, Init, Node, Registration,
  RegistrationAction, Reserved, Tail, Update,
}

const own = #"7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e"

/// The pool before `pool` in the pool list.
const pool_a = #"a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"

/// The pool's cold key hash, its pool_id.
const pool = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"

/// The pool after `pool` in the pool list.
const pool_c = #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const owner_key = #"0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d"

const owner_script = #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"

const other_key = #"0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c"

const staker = #"0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a"

/// Four crch keys in rising order.
const crch_a =
  #"2020202020202020202020202020202020202020202020202020202020202020"

const crch_b =
  #"3030303030303030303030303030303030303030303030303030303030303030"

const crch_c =
  #"4040404040404040404040404040404040404040404040404040404040404040"

const crch_d =
  #"5050505050505050505050505050505050505050505050505050505050505050"

/// A 33-byte key whose bytes sort above those of `key_34`.
const key_33 =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

/// A 34-byte key whose bytes sort below those of `key_33`.
const key_34 =
  #"00000000000000000000000000000000000000000000000000000000000000000000"

const crch_signature =
  #"5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a"

const aura_key =
  #"e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1"

const aura_signature =
  #"e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2"

const reward =
  #"d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0"

const one_shot =
  OutputReference(
    config.night_registration_one_shot_hash,
    config.night_registration_one_shot_index,
  )

fn bytes(n: Int) -> ByteArray {
  if n == 0 {
    ""
  } else {
    #"aa" |> bytearray.concat(bytes(n - 1))
  }
}

/// 2^128 - 1, the largest fixed_cost (rule 9).
const max_fixed_cost = 340_282_366_920_938_463_463_374_607_431_768_211_455

/// The fields of a Registration, in a one-constructor type so a test can change one field
/// with a record update.
type Fields {
  active: Bool,
  crch: ByteArray,
  prev_crch: ByteArray,
  pool_id: ByteArray,
  prev_pool: ByteArray,
  owner: Credential,
  crch_signature: ByteArray,
  keys: Pairs<ByteArray, ByteArray>,
  signatures: Pairs<ByteArray, ByteArray>,
  reward_address: ByteArray,
  fixed_cost: Int,
  attributes: Pairs<ByteArray, Data>,
}

fn registration(f: Fields) -> Node {
  Registration {
    active: f.active,
    crch: f.crch,
    prev_crch: f.prev_crch,
    pool_id: f.pool_id,
    prev_pool: f.prev_pool,
    owner: f.owner,
    crch_signature: f.crch_signature,
    keys: f.keys,
    signatures: f.signatures,
    reward_address: f.reward_address,
    fixed_cost: f.fixed_cost,
    attributes: f.attributes,
  }
}

/// An active Registration for `pool` with crch `crch_b`, linked to `crch_a` and `pool_a`.
const active =
  Fields {
    active: True,
    crch: crch_b,
    prev_crch: crch_a,
    pool_id: pool,
    prev_pool: pool_a,
    owner: VerificationKey(owner_key),
    crch_signature,
    keys: [Pair(#"61757261", aura_key)],
    signatures: [Pair(#"61757261", aura_signature)],
    reward_address: reward,
    fixed_cost: 340_000_000,
    attributes: [],
  }

/// `active` deactivated: crch and prev_crch kept, every other field cleared.
const cleared =
  Fields {
    active: False,
    crch: crch_b,
    prev_crch: crch_a,
    pool_id: #"",
    prev_pool: #"",
    owner: VerificationKey(#""),
    crch_signature: #"",
    keys: [],
    signatures: [],
    reward_address: #"",
    fixed_cost: 0,
    attributes: [],
  }

fn node_value(lovelace: Int) -> Value {
  assets.from_lovelace(lovelace) |> assets.add(own, "", 1)
}

fn node_output(lovelace: Int, node: Node) -> Output {
  Output {
    address: Address(Script(own), None),
    value: node_value(lovelace),
    datum: InlineDatum(node),
    reference_script: None,
  }
}

fn node_input(index: Int, node: Node) -> Input {
  Input {
    output_reference: OutputReference(#"77", index),
    output: node_output(1_500_000, node),
  }
}

const wallet_input =
  Input {
    output_reference: OutputReference(#"55", 0),
    output: Output {
      address: Address(VerificationKey(staker), None),
      value: assets.from_lovelace(10_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }

const change =
  Output {
    address: Address(VerificationKey(staker), None),
    value: assets.from_lovelace(5_000_000),
    datum: NoDatum,
    reference_script: None,
  }

fn list_append(self: List<a>, last: a) -> List<a> {
  when self is {
    [] -> [last]
    [x, ..rest] -> [x, ..list_append(rest, last)]
  }
}

/// A mint or spend purpose: the gate reads no redeemer.
fn gate(tx: Transaction, info: ScriptInfo) -> Bool {
  night_registration.night_registration.else(
    ScriptContext { transaction: tx, redeemer: Void, info },
  )
}

/// The withdrawal, with the redeemer the transaction carries for it, as the ledger passes it.
fn withdraws(tx: Transaction) -> Bool {
  expect Some(Pair(_, redeemer)) =
    list.find(tx.redeemers, fn(pair) { pair.1st == Withdraw(Script(own)) })
  night_registration.night_registration.else(
    ScriptContext { transaction: tx, redeemer, info: Withdrawing(Script(own)) },
  )
}

/// The transaction as the ledger checks a mint: the mint's gate and the withdrawal.
fn mints(tx: Transaction) -> Bool {
  and {
    gate(tx, Minting(own)),
    withdraws(tx),
  }
}

/// The transaction as the ledger checks the spend of the node at output index 0 of
/// transaction #"77": the spend's gate and the withdrawal.
fn spends(tx: Transaction) -> Bool {
  and {
    gate(tx, Spending { output: OutputReference(#"77", 0), datum: None }),
    withdraws(tx),
  }
}

/// The withdrawal from night_registration, its balance 0.
const gate_withdrawal = [Pair(Script(own), 0)]

/// The withdrawal redeemer that names `action`.
fn acting(action: RegistrationAction) -> Pairs<ScriptPurpose, Data> {
  [Pair(Withdraw(Script(own)), as_data(action))]
}

fn updating() -> Pairs<ScriptPurpose, Data> {
  acting(Update)
}

// Initialization (diagram 6): the Reserved nodes in rising crch order, then the Tail.

fn init_tx(outputs: List<Output>, count: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [Input { ..wallet_input, output_reference: one_shot }],
    outputs,
    mint: assets.from_asset(own, "", count),
    withdrawals: gate_withdrawal,
    redeemers: acting(Init),
  }
}

fn init_nodes() -> List<Output> {
  [
    node_output(1_500_000, Reserved { crch: crch_a, prev_crch: #"" }),
    node_output(1_500_000, Reserved { crch: crch_c, prev_crch: crch_a }),
    node_output(1_500_000, Tail { prev_crch: crch_c, prev_pool: #"" }),
  ]
}

test init_two_reserved_and_the_tail() {
  mints(init_tx(init_nodes(), 3))
}

test init_tail_alone() {
  mints(
    init_tx(
      [node_output(1_500_000, Tail { prev_crch: #"", prev_pool: #"" })],
      1,
    ),
  )
}

test init_change_between_nodes() fail {
  // The nodes are the first outputs (user decision, 11-17).
  expect [first, ..rest] = init_nodes()
  mints(init_tx([first, change, ..rest], 3))
}

test init_without_one_shot() fail {
  mints(Transaction { ..init_tx(init_nodes(), 3), inputs: [wallet_input] })
}

test init_reserved_out_of_order() fail {
  mints(
    init_tx(
      [
        node_output(1_500_000, Reserved { crch: crch_c, prev_crch: #"" }),
        node_output(1_500_000, Reserved { crch: crch_a, prev_crch: crch_c }),
        node_output(1_500_000, Tail { prev_crch: crch_a, prev_pool: #"" }),
      ],
      3,
    ),
  )
}

test init_reserved_twice() fail {
  mints(
    init_tx(
      [
        node_output(1_500_000, Reserved { crch: crch_a, prev_crch: #"" }),
        node_output(1_500_000, Reserved { crch: crch_a, prev_crch: crch_a }),
        node_output(1_500_000, Tail { prev_crch: crch_a, prev_pool: #"" }),
      ],
      3,
    ),
  )
}

test init_reserved_empty_crch() fail {
  mints(
    init_tx(
      [
        node_output(1_500_000, Reserved { crch: #"", prev_crch: #"" }),
        node_output(1_500_000, Tail { prev_crch: #"", prev_pool: #"" }),
      ],
      2,
    ),
  )
}

test init_tail_skips_a_reserved() fail {
  mints(
    init_tx(
      [
        node_output(1_500_000, Reserved { crch: crch_a, prev_crch: #"" }),
        node_output(1_500_000, Reserved { crch: crch_c, prev_crch: crch_a }),
        node_output(1_500_000, Tail { prev_crch: crch_a, prev_pool: #"" }),
      ],
      3,
    ),
  )
}

test init_first_link_not_empty() fail {
  mints(
    init_tx(
      [
        node_output(1_500_000, Reserved { crch: crch_c, prev_crch: crch_a }),
        node_output(1_500_000, Tail { prev_crch: crch_c, prev_pool: #"" }),
      ],
      2,
    ),
  )
}

test init_tail_prev_pool_set() fail {
  mints(
    init_tx(
      [node_output(1_500_000, Tail { prev_crch: #"", prev_pool: pool })],
      1,
    ),
  )
}

test init_tail_first() fail {
  mints(
    init_tx(
      [
        node_output(1_500_000, Tail { prev_crch: crch_a, prev_pool: #"" }),
        node_output(1_500_000, Reserved { crch: crch_a, prev_crch: #"" }),
      ],
      2,
    ),
  )
}

test init_second_tail_first() fail {
  // The Tail is the last node: a second Tail cannot open the list.
  mints(
    init_tx(
      [
        node_output(1_500_000, Tail { prev_crch: #"", prev_pool: #"" }),
        node_output(1_500_000, Reserved { crch: crch_a, prev_crch: #"" }),
        node_output(1_500_000, Tail { prev_crch: crch_a, prev_pool: #"" }),
      ],
      3,
    ),
  )
}

test init_with_registration() fail {
  mints(
    init_tx(
      [
        node_output(
          1_500_000,
          registration(Fields { ..active, prev_crch: #"", prev_pool: #"" }),
        ),
        node_output(1_500_000, Tail { prev_crch: crch_b, prev_pool: pool }),
      ],
      2,
    ),
  )
}

test init_mints_one_more() fail {
  mints(init_tx(init_nodes(), 4))
}

test init_mints_one_fewer() fail {
  mints(init_tx(init_nodes(), 2))
}

test init_spends_a_node() fail {
  let tx = init_tx(init_nodes(), 3)
  mints(
    Transaction {
      ..tx,
      inputs: [
        node_input(0, Tail { prev_crch: #"", prev_pool: #"" }),
        ..tx.inputs
      ],
    },
  )
}

test init_node_with_stake_part() fail {
  expect [first, ..rest] = init_nodes()
  mints(
    init_tx(
      [
        Output {
          ..first,
          address: Address(Script(own), Some(Inline(Script(own)))),
        },
        ..rest
      ],
      3,
    ),
  )
}

// Rule 9, the crch order (user decision, 11-18): by length, then by bytes.

test init_33_bytes_before_34_bytes_that_sort_lower() {
  mints(
    init_tx(
      [
        node_output(1_500_000, Reserved { crch: key_33, prev_crch: #"" }),
        node_output(1_500_000, Reserved { crch: key_34, prev_crch: key_33 }),
        node_output(1_500_000, Tail { prev_crch: key_34, prev_pool: #"" }),
      ],
      3,
    ),
  )
}

test init_34_bytes_before_33_bytes_that_sort_higher() fail {
  mints(
    init_tx(
      [
        node_output(1_500_000, Reserved { crch: key_34, prev_crch: #"" }),
        node_output(1_500_000, Reserved { crch: key_33, prev_crch: key_34 }),
        node_output(1_500_000, Tail { prev_crch: key_33, prev_pool: #"" }),
      ],
      3,
    ),
  )
}

// Create, one anchor (diagram 7b): the Tail anchors crch_b in both lists, a new last node.

const tail_before = Tail { prev_crch: crch_a, prev_pool: pool_a }

const tail_after = Tail { prev_crch: crch_b, prev_pool: pool }

const delegation =
  DelegateCredential {
    credential: VerificationKey(staker),
    delegate: DelegateBlockProduction(pool),
  }

/// A Create whose withdrawal carries `action`.
fn create_tx_as(
  action: RegistrationAction,
  anchors: List<Input>,
  new_node: Node,
  anchor_outputs: List<Output>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [wallet_input, ..anchors],
    outputs: [node_output(2_000_000, new_node), ..anchor_outputs]
      |> list_append(change),
    mint: assets.from_asset(own, "", 1),
    extra_signatories: [pool],
    certificates: [delegation],
    withdrawals: gate_withdrawal,
    redeemers: acting(action),
  }
}

/// A Create with one anchor (diagram 7b).
fn create_tx(
  anchors: List<Input>,
  new_node: Node,
  anchor_outputs: List<Output>,
) -> Transaction {
  create_tx_as(CreateOneAnchor, anchors, new_node, anchor_outputs)
}

/// A Create with two anchors (diagram 7a).
fn create_two_tx(
  anchors: List<Input>,
  new_node: Node,
  anchor_outputs: List<Output>,
) -> Transaction {
  create_tx_as(CreateTwoAnchors, anchors, new_node, anchor_outputs)
}

fn create_7b() -> Transaction {
  create_tx(
    [node_input(0, tail_before)],
    registration(active),
    [node_output(1_500_000, tail_after)],
  )
}

/// A Create of `node` before the Tail, whose crch and pool_id sort after crch_a and pool_a.
fn creates(node: Node) -> Bool {
  mints(
    create_tx(
      [node_input(0, tail_before)],
      node,
      [node_output(1_500_000, tail_after)],
    ),
  )
}

test create_one_anchor() {
  mints(create_7b())
}

test create_spend_passes_with_the_mint() {
  spends(create_7b())
}

test create_register_and_delegate() {
  mints(
    Transaction {
      ..create_7b(),
      certificates: [
        RegisterAndDelegateCredential {
          credential: VerificationKey(staker),
          delegate: DelegateBlockProduction(pool),
          deposit: 2_000_000,
        },
      ],
    },
  )
}

test create_delegate_both() {
  mints(
    Transaction {
      ..create_7b(),
      certificates: [
        DelegateCredential {
          credential: Script(owner_script),
          delegate: DelegateBoth(pool, AlwaysAbstain),
        },
      ],
    },
  )
}

test create_delegate_vote_only() fail {
  mints(
    Transaction {
      ..create_7b(),
      certificates: [
        DelegateCredential {
          credential: VerificationKey(staker),
          delegate: DelegateVote(AlwaysAbstain),
        },
      ],
    },
  )
}

test create_delegation_to_another_pool() fail {
  mints(
    Transaction {
      ..create_7b(),
      certificates: [
        DelegateCredential {
          credential: VerificationKey(staker),
          delegate: DelegateBlockProduction(pool_c),
        },
      ],
    },
  )
}

test create_delegate_both_to_another_pool() fail {
  mints(
    Transaction {
      ..create_7b(),
      certificates: [
        DelegateCredential {
          credential: VerificationKey(staker),
          delegate: DelegateBoth(pool_c, AlwaysAbstain),
        },
      ],
    },
  )
}

test create_without_certificate() fail {
  mints(Transaction { ..create_7b(), certificates: [] })
}

test create_without_cold_key() fail {
  mints(Transaction { ..create_7b(), extra_signatories: [owner_key] })
}

test create_mints_two() fail {
  mints(Transaction { ..create_7b(), mint: assets.from_asset(own, "", 2) })
}

test create_change_before_nodes() fail {
  let tx = create_7b()
  mints(Transaction { ..tx, outputs: [change, ..tx.outputs] })
}

test create_anchor_before_new_node() fail {
  mints(
    Transaction {
      ..create_7b(),
      outputs: [
        node_output(1_500_000, tail_after),
        node_output(2_000_000, registration(active)),
        change,
      ],
    },
  )
}

test create_second_new_node() fail {
  let tx = create_7b()
  mints(
    Transaction {
      ..tx,
      outputs: list_append(
        tx.outputs,
        node_output(2_000_000, registration(active)),
      ),
    },
  )
}

test create_inactive_node() fail {
  mints(
    create_tx(
      [node_input(0, tail_before)],
      registration(cleared),
      [node_output(1_500_000, Tail { prev_crch: crch_b, prev_pool: pool_a })],
    ),
  )
}

test create_inactive_node_with_fields() fail {
  // An inactive new node would sit in the pool list.
  creates(registration(Fields { ..active, active: False }))
}

test create_reserved_node() fail {
  mints(
    create_tx(
      [node_input(0, tail_before)],
      Reserved { crch: crch_b, prev_crch: crch_a },
      [node_output(1_500_000, Tail { prev_crch: crch_b, prev_pool: pool_a })],
    ),
  )
}

test create_tail() fail {
  mints(
    create_tx(
      [node_input(0, tail_before)],
      Tail { prev_crch: crch_b, prev_pool: pool },
      [node_output(1_500_000, tail_after)],
    ),
  )
}

test create_crch_already_taken() fail {
  // The anchor's link is crch_b.
  mints(
    create_tx(
      [node_input(0, Tail { prev_crch: crch_b, prev_pool: pool_a })],
      registration(Fields { ..active, prev_crch: crch_b }),
      [node_output(1_500_000, tail_after)],
    ),
  )
}

test create_crch_below_the_old_link() fail {
  // crch_a sorts below the anchor's link, crch_b.
  mints(
    create_tx(
      [node_input(0, Tail { prev_crch: crch_b, prev_pool: pool_a })],
      registration(Fields { ..active, crch: crch_a, prev_crch: crch_b }),
      [node_output(1_500_000, Tail { prev_crch: crch_a, prev_pool: pool })],
    ),
  )
}

test create_pool_already_active() fail {
  // The anchor's link is pool.
  mints(
    create_tx(
      [node_input(0, Tail { prev_crch: crch_a, prev_pool: pool })],
      registration(Fields { ..active, prev_pool: pool }),
      [node_output(1_500_000, tail_after)],
    ),
  )
}

test create_pool_below_the_old_link() fail {
  // pool_a sorts below the anchor's link, pool.
  mints(
    Transaction {
      ..create_tx(
        [node_input(0, Tail { prev_crch: crch_a, prev_pool: pool })],
        registration(Fields { ..active, pool_id: pool_a, prev_pool: pool }),
        [node_output(1_500_000, Tail { prev_crch: crch_b, prev_pool: pool_a })],
      ),
      extra_signatories: [pool_a],
      certificates: [
        DelegateCredential {
          credential: VerificationKey(staker),
          delegate: DelegateBlockProduction(pool_a),
        },
      ],
    },
  )
}

test create_new_node_wrong_prev_crch() fail {
  creates(registration(Fields { ..active, prev_crch: #"" }))
}

test create_new_node_wrong_prev_pool() fail {
  creates(registration(Fields { ..active, prev_pool: #"" }))
}

test create_anchor_keeps_old_link() fail {
  mints(
    create_tx(
      [node_input(0, tail_before)],
      registration(active),
      [node_output(1_500_000, Tail { prev_crch: crch_b, prev_pool: pool_a })],
    ),
  )
}

test create_anchor_ada_falls() fail {
  mints(
    create_tx(
      [node_input(0, tail_before)],
      registration(active),
      [node_output(1_499_999, tail_after)],
    ),
  )
}

test create_anchor_ada_rises() {
  mints(
    create_tx(
      [node_input(0, tail_before)],
      registration(active),
      [node_output(1_600_000, tail_after)],
    ),
  )
}

test create_reserved_as_both_anchors() fail {
  // A Reserved node is outside the pool list.
  mints(
    create_tx(
      [node_input(0, Reserved { crch: crch_c, prev_crch: crch_a })],
      registration(active),
      [node_output(1_500_000, Reserved { crch: crch_c, prev_crch: crch_b })],
    ),
  )
}

test create_registration_as_both_anchors() {
  // An active node after the new one in both lists.
  let anchor =
    Fields { ..active, crch: crch_c, prev_crch: crch_a, pool_id: pool_c }
  mints(
    create_tx(
      [node_input(0, registration(anchor))],
      registration(active),
      [
        node_output(
          1_500_000,
          registration(Fields { ..anchor, prev_crch: crch_b, prev_pool: pool }),
        ),
      ],
    ),
  )
}

test create_node_with_cnight() fail {
  let tx = create_7b()
  expect [new, ..rest] = tx.outputs
  mints(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..new,
          value: assets.add(
            new.value,
            config.cnight_policy,
            config.cnight_name,
            1,
          ),
        },
        ..rest
      ],
    },
  )
}

test create_node_with_stake_part() fail {
  let tx = create_7b()
  expect [new, ..rest] = tx.outputs
  mints(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..new,
          address: Address(Script(own), Some(Inline(Script(own)))),
        },
        ..rest
      ],
    },
  )
}

test create_node_without_inline_datum() fail {
  let tx = create_7b()
  expect [new, ..rest] = tx.outputs
  mints(
    Transaction { ..tx, outputs: [Output { ..new, datum: NoDatum }, ..rest] },
  )
}

// Rule 9: a node holds no reference script.

test init_node_with_reference_script() fail {
  expect [first, ..rest] = init_nodes()
  mints(
    init_tx(
      [Output { ..first, reference_script: Some(owner_script) }, ..rest],
      3,
    ),
  )
}

test create_node_with_reference_script() fail {
  let tx = create_7b()
  expect [new, ..rest] = tx.outputs
  mints(
    Transaction {
      ..tx,
      outputs: [Output { ..new, reference_script: Some(owner_script) }, ..rest],
    },
  )
}

test create_anchor_with_reference_script() fail {
  let tx = create_7b()
  expect [new, anchor, ..rest] = tx.outputs
  mints(
    Transaction {
      ..tx,
      outputs: [
        new,
        Output { ..anchor, reference_script: Some(owner_script) },
        ..rest
      ],
    },
  )
}

test update_node_with_reference_script() fail {
  let tx = update_tx(changed, 1_500_000, owner_key)
  expect [node, ..rest] = tx.outputs
  spends(
    Transaction {
      ..tx,
      outputs: [Output { ..node, reference_script: Some(owner_script) }, ..rest],
    },
  )
}

test deactivate_node_with_reference_script() fail {
  spends(
    deactivate_tx(
      [
        Output {
          ..node_output(1_000_000, registration(cleared)),
          reference_script: Some(owner_script),
        },
        node_output(1_500_000, anchor_after),
        change,
      ],
    ),
  )
}

// Rule 9: crch and crch_signature are bytes of any length, and the crch list keeps a crch
// from being empty.

/// A Create of a node with `crch` as the first of the crch list, before the Tail.
fn creates_with_crch(crch: ByteArray) -> Bool {
  mints(
    create_tx(
      [node_input(0, Tail { prev_crch: #"", prev_pool: pool_a })],
      registration(Fields { ..active, crch, prev_crch: #"" }),
      [node_output(1_500_000, Tail { prev_crch: crch, prev_pool: pool })],
    ),
  )
}

test create_crch_1_byte() {
  creates_with_crch(#"30")
}

test create_crch_31_bytes() {
  creates_with_crch(bytes(31))
}

test create_crch_33_bytes() {
  creates_with_crch(key_33)
}

test create_crch_empty() fail {
  creates_with_crch(#"")
}

test create_crch_signature_63_bytes() {
  creates(registration(Fields { ..active, crch_signature: bytes(63) }))
}

test create_crch_signature_65_bytes() {
  creates(registration(Fields { ..active, crch_signature: bytes(65) }))
}

test create_crch_signature_empty() {
  creates(registration(Fields { ..active, crch_signature: #"" }))
}

// Rule 9, the crch order (user decision, 11-18): by length, then by bytes.

/// A Create of a node with `crch` before the Tail, whose link is `link`.
fn creates_after(link: ByteArray, crch: ByteArray) -> Bool {
  mints(
    create_tx(
      [node_input(0, Tail { prev_crch: link, prev_pool: pool_a })],
      registration(Fields { ..active, crch, prev_crch: link }),
      [node_output(1_500_000, Tail { prev_crch: crch, prev_pool: pool })],
    ),
  )
}

/// A Create of a node with `crch` before the Reserved node of `anchor_crch`, the first of
/// the crch list; the Tail anchors the pool list.
fn creates_before(anchor_crch: ByteArray, crch: ByteArray) -> Bool {
  mints(
    create_two_tx(
      [
        node_input(0, Tail { prev_crch: anchor_crch, prev_pool: pool_a }),
        node_input(1, Reserved { crch: anchor_crch, prev_crch: #"" }),
      ],
      registration(Fields { ..active, crch, prev_crch: #"" }),
      [
        node_output(1_500_000, Reserved { crch: anchor_crch, prev_crch: crch }),
        node_output(1_500_000, Tail { prev_crch: anchor_crch, prev_pool: pool }),
      ],
    ),
  )
}

test create_34_bytes_after_33_bytes_that_sort_higher() {
  creates_after(key_33, key_34)
}

test create_33_bytes_after_34_bytes_that_sort_lower() fail {
  creates_after(key_34, key_33)
}

test create_33_bytes_before_34_bytes_that_sort_lower() {
  creates_before(key_34, key_33)
}

test create_34_bytes_before_33_bytes_that_sort_higher() fail {
  creates_before(key_33, key_34)
}

// Rule 9 field lengths of a new node.

test create_pool_id_27_bytes() fail {
  // A 27-byte cold key hash that signs and is delegated to.
  let short = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"
  mints(
    Transaction {
      ..create_tx(
        [node_input(0, tail_before)],
        registration(Fields { ..active, pool_id: short }),
        [node_output(1_500_000, Tail { prev_crch: crch_b, prev_pool: short })],
      ),
      extra_signatories: [short],
      certificates: [
        DelegateCredential {
          credential: VerificationKey(staker),
          delegate: DelegateBlockProduction(short),
        },
      ],
    },
  )
}

test create_pool_id_29_bytes() fail {
  // A 29-byte cold key hash that signs and is delegated to.
  let long = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"
  mints(
    Transaction {
      ..create_tx(
        [node_input(0, tail_before)],
        registration(Fields { ..active, pool_id: long }),
        [node_output(1_500_000, Tail { prev_crch: crch_b, prev_pool: long })],
      ),
      extra_signatories: [long],
      certificates: [
        DelegateCredential {
          credential: VerificationKey(staker),
          delegate: DelegateBlockProduction(long),
        },
      ],
    },
  )
}

test create_owner_hash_27_bytes() fail {
  creates(registration(Fields { ..active, owner: VerificationKey(bytes(27)) }))
}

test create_owner_script_hash_29_bytes() fail {
  creates(registration(Fields { ..active, owner: Script(bytes(29)) }))
}

test create_owner_script() {
  creates(registration(Fields { ..active, owner: Script(owner_script) }))
}

test create_reward_address_31_bytes() fail {
  creates(registration(Fields { ..active, reward_address: bytes(31) }))
}

test create_reward_address_33_bytes() fail {
  creates(registration(Fields { ..active, reward_address: bytes(33) }))
}

test create_fixed_cost_negative() fail {
  creates(registration(Fields { ..active, fixed_cost: -1 }))
}

test create_fixed_cost_zero() {
  creates(registration(Fields { ..active, fixed_cost: 0 }))
}

test create_fixed_cost_max() {
  creates(registration(Fields { ..active, fixed_cost: max_fixed_cost }))
}

test create_fixed_cost_above_max() fail {
  creates(registration(Fields { ..active, fixed_cost: max_fixed_cost + 1 }))
}

test create_maps_not_checked() {
  let one: Data = 1
  let two: Data = 2
  creates(
    registration(
      Fields {
        ..active,
        keys: [Pair(#"61757261", #""), Pair(#"61757261", bytes(3))],
        signatures: [Pair(#"", #"")],
        attributes: [Pair(#"01", one), Pair(#"01", two)],
      },
    ),
  )
}

// Rule 9, NODE_DATUM_MAX: the datum of every node output, as serialise_data encodes it with
// both links #"".

fn datum_size(node: Node) -> Int {
  let data: Data = node
  builtin.length_of_bytearray(builtin.serialise_data(data))
}

fn unlinked_size(fields: Fields) -> Int {
  datum_size(registration(Fields { ..fields, prev_crch: #"", prev_pool: #"" }))
}

/// `fields` with one attribute of `n` bytes under `name`.
fn padded_with(fields: Fields, name: ByteArray, n: Int) -> Fields {
  let pad: Data = builtin.replicate_byte(n, 0xaa)
  Fields { ..fields, attributes: [Pair(name, pad)] }
}

/// `fields` padded so that its datum without the links is exactly `size` bytes. A long
/// byte string grows in steps of up to three bytes, so a one-byte attribute name fills the
/// gap.
fn sized(fields: Fields, size: Int) -> Fields {
  // 200 bytes cover the attribute and the chunk headers of a long byte string.
  fit(fields, size, size - unlinked_size(fields) - 200)
}

fn fit(fields: Fields, size: Int, n: Int) -> Fields {
  let plain = padded_with(fields, "", n)
  let named = padded_with(fields, #"00", n)
  if unlinked_size(plain) == size {
    plain
  } else if unlinked_size(named) == size {
    named
  } else {
    fit(fields, size, n + 1)
  }
}

test create_node_datum_at_the_limit() {
  let node = sized(active, config.node_datum_max)
  and {
    unlinked_size(node) == config.node_datum_max,
    // Its links count against nothing.
    datum_size(registration(node)) > config.node_datum_max,
    creates(registration(node)),
  }
}

test sized_reaches_one_byte_past_the_limit() {
  unlinked_size(sized(active, config.node_datum_max + 1)) == config.node_datum_max + 1
}

test create_node_datum_one_byte_past_the_limit() fail {
  let node = sized(active, config.node_datum_max + 1)
  creates(registration(node))
}

test update_node_datum_at_the_limit() {
  spends(update_tx(sized(active, config.node_datum_max), 1_500_000, pool))
}

test update_grows_node_one_byte_past_the_limit() fail {
  spends(update_tx(sized(active, config.node_datum_max + 1), 1_500_000, pool))
}

test create_three_nodes_at_the_limit() {
  // The new node between two anchors, each at NODE_DATUM_MAX: the crch anchor holds crch_c,
  // and the pool anchor pool_c.
  let crch_anchor =
    sized(
      Fields {
        ..active,
        crch: crch_c,
        prev_crch: crch_a,
        pool_id: #"b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4",
        prev_pool: pool_c,
      },
      config.node_datum_max,
    )
  let pool_anchor =
    sized(
      Fields {
        ..active,
        crch: crch_d,
        prev_crch: crch_c,
        pool_id: pool_c,
        prev_pool: pool_a,
      },
      config.node_datum_max,
    )
  mints(
    create_two_tx(
      [
        node_input(0, registration(crch_anchor)),
        node_input(1, registration(pool_anchor)),
      ],
      registration(sized(active, config.node_datum_max)),
      [
        node_output(
          1_500_000,
          registration(Fields { ..crch_anchor, prev_crch: crch_b }),
        ),
        node_output(
          1_500_000,
          registration(Fields { ..pool_anchor, prev_pool: pool }),
        ),
      ],
    ),
  )
}

test create_anchor_at_the_limit_takes_a_longer_link() {
  // The new link, a 33-byte crch, is longer than the old one; the limit leaves it out.
  let anchor =
    sized(
      Fields {
        ..active,
        crch: key_34,
        prev_crch: #"",
        pool_id: pool_c,
        prev_pool: pool_a,
      },
      config.node_datum_max,
    )
  mints(
    create_tx(
      [node_input(0, registration(anchor))],
      registration(Fields { ..active, crch: key_33, prev_crch: #"" }),
      [
        node_output(
          1_500_000,
          registration(Fields { ..anchor, prev_crch: key_33, prev_pool: pool }),
        ),
      ],
    ),
  )
}

// Create, two anchors (diagram 7a): Reserved crch_c anchors the crch list, the Tail the
// pool list.

const reserved_before = Reserved { crch: crch_c, prev_crch: crch_a }

const reserved_after = Reserved { crch: crch_c, prev_crch: crch_b }

const tail_7a_before = Tail { prev_crch: crch_c, prev_pool: pool_a }

const tail_7a_after = Tail { prev_crch: crch_c, prev_pool: pool }

fn create_7a(crch_output: Output, pool_output: Output) -> Transaction {
  create_two_tx(
    [node_input(0, tail_7a_before), node_input(1, reserved_before)],
    registration(active),
    [crch_output, pool_output],
  )
}

test create_two_anchors() {
  mints(
    create_7a(
      node_output(1_500_000, reserved_after),
      node_output(1_500_000, tail_7a_after),
    ),
  )
}

test create_two_anchors_other_order() {
  mints(
    Transaction {
      ..create_7a(
        node_output(1_500_000, reserved_after),
        node_output(1_500_000, tail_7a_after),
      ),
      inputs: [
        wallet_input,
        node_input(1, reserved_before),
        node_input(0, tail_7a_before),
      ],
    },
  )
}

test create_pool_anchor_before_crch_anchor() fail {
  mints(
    create_7a(
      node_output(1_500_000, tail_7a_after),
      node_output(1_500_000, reserved_after),
    ),
  )
}

test create_crch_anchor_ada_falls() fail {
  mints(
    create_7a(
      node_output(1_000_000, reserved_after),
      node_output(1_500_000, tail_7a_after),
    ),
  )
}

test create_pool_anchor_ada_falls() fail {
  mints(
    create_7a(
      node_output(1_500_000, reserved_after),
      node_output(1_000_000, tail_7a_after),
    ),
  )
}

test create_crch_anchor_changes_its_crch() fail {
  mints(
    create_7a(
      node_output(1_500_000, Reserved { crch: #"41", prev_crch: crch_b }),
      node_output(1_500_000, tail_7a_after),
    ),
  )
}

test create_pool_anchor_changes_its_crch_link() fail {
  mints(
    create_7a(
      node_output(1_500_000, reserved_after),
      node_output(1_500_000, Tail { prev_crch: crch_b, prev_pool: pool }),
    ),
  )
}

test create_inactive_registration_as_crch_anchor() {
  mints(
    create_two_tx(
      [
        node_input(0, tail_7a_before),
        node_input(1, registration(Fields { ..cleared, crch: crch_c })),
      ],
      registration(active),
      [
        node_output(
          1_500_000,
          registration(Fields { ..cleared, crch: crch_c, prev_crch: crch_b }),
        ),
        node_output(1_500_000, tail_7a_after),
      ],
    ),
  )
}

test create_inactive_registration_as_pool_anchor() fail {
  // An inactive node is outside the pool list. The new node's prev_pool matches the
  // anchor's empty link, so only the membership check rejects.
  let anchor = Fields { ..cleared, crch: crch_d, prev_crch: crch_c }
  mints(
    create_two_tx(
      [node_input(0, reserved_before), node_input(1, registration(anchor))],
      registration(Fields { ..active, prev_pool: #"" }),
      [
        node_output(1_500_000, reserved_after),
        node_output(
          1_500_000,
          registration(Fields { ..anchor, prev_pool: pool }),
        ),
      ],
    ),
  )
}

test create_inactive_registration_with_fields_as_pool_anchor() fail {
  // An inactive node that still holds a pool_id above the new one (unreachable through
  // Deactivate) is outside the pool list too.
  let anchor =
    Fields {
      ..active,
      active: False,
      crch: crch_d,
      prev_crch: crch_c,
      pool_id: pool_c,
      prev_pool: #"",
    }
  mints(
    create_two_tx(
      [node_input(0, reserved_before), node_input(1, registration(anchor))],
      registration(Fields { ..active, prev_pool: #"" }),
      [
        node_output(1_500_000, reserved_after),
        node_output(
          1_500_000,
          registration(Fields { ..anchor, prev_pool: pool }),
        ),
      ],
    ),
  )
}

test create_crch_above_its_anchor() fail {
  // The crch anchor, Reserved crch_a, sorts below crch_b.
  mints(
    create_two_tx(
      [
        node_input(0, Tail { prev_crch: crch_c, prev_pool: pool_a }),
        node_input(1, Reserved { crch: crch_a, prev_crch: #"" }),
      ],
      registration(Fields { ..active, prev_crch: #"" }),
      [
        node_output(1_500_000, Reserved { crch: crch_a, prev_crch: crch_b }),
        node_output(1_500_000, Tail { prev_crch: crch_c, prev_pool: pool }),
      ],
    ),
  )
}

test create_pool_above_its_anchor() fail {
  // The pool anchor, the active node of pool_a, sorts below pool.
  let anchor =
    Fields {
      ..active,
      crch: crch_d,
      prev_crch: crch_c,
      pool_id: pool_a,
      prev_pool: #"",
    }
  mints(
    create_two_tx(
      [node_input(0, reserved_before), node_input(1, registration(anchor))],
      registration(Fields { ..active, prev_pool: #"" }),
      [
        node_output(1_500_000, reserved_after),
        node_output(
          1_500_000,
          registration(Fields { ..anchor, prev_pool: pool }),
        ),
      ],
    ),
  )
}

test create_third_node_spent() fail {
  let tx =
    create_7a(
      node_output(1_500_000, reserved_after),
      node_output(1_500_000, tail_7a_after),
    )
  mints(
    Transaction {
      ..tx,
      inputs: [
        node_input(2, Reserved { crch: crch_d, prev_crch: crch_c }),
        ..tx.inputs
      ],
    },
  )
}

test create_third_node_output() fail {
  let tx =
    create_7a(
      node_output(1_500_000, reserved_after),
      node_output(1_500_000, tail_7a_after),
    )
  mints(
    Transaction {
      ..tx,
      outputs: list_append(
        tx.outputs,
        node_output(1_500_000, Reserved { crch: crch_d, prev_crch: crch_c }),
      ),
    },
  )
}

// Update (diagram 8): the node of `active`, spent and recreated first.

fn update_tx(after: Fields, lovelace: Int, signer: ByteArray) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [node_input(0, registration(active)), wallet_input],
    outputs: [node_output(lovelace, registration(after)), change],
    extra_signatories: [signer],
    withdrawals: gate_withdrawal,
    redeemers: updating(),
  }
}

const changed =
  Fields {
    ..active,
    reward_address: #"d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1",
    fixed_cost: 0,
  }

test update_under_owner() {
  spends(update_tx(changed, 1_500_000, owner_key))
}

test update_under_cold_key() {
  spends(update_tx(changed, 1_500_000, pool))
}

test update_without_owner_or_cold_key() fail {
  spends(update_tx(changed, 1_500_000, other_key))
}

test update_new_owner_under_cold_key() {
  spends(
    update_tx(
      Fields { ..active, owner: VerificationKey(other_key) },
      1_500_000,
      pool,
    ),
  )
}

test update_new_owner_under_owner() fail {
  spends(
    update_tx(
      Fields { ..active, owner: VerificationKey(other_key) },
      1_500_000,
      owner_key,
    ),
  )
}

fn script_owned_update(
  withdrawals: Pairs<Credential, Int>,
  signers: List<ByteArray>,
) -> Bool {
  let owned = Fields { ..active, owner: Script(owner_script) }
  spends(
    Transaction {
      ..placeholder,
      inputs: [node_input(0, registration(owned)), wallet_input],
      outputs: [
        node_output(1_500_000, registration(Fields { ..owned, fixed_cost: 0 })),
        change,
      ],
      extra_signatories: signers,
      withdrawals: [Pair(Script(own), 0), ..withdrawals],
      redeemers: updating(),
    },
  )
}

test update_script_owner_with_withdrawal() {
  script_owned_update([Pair(Script(owner_script), 0)], [])
}

test update_script_owner_without_withdrawal() fail {
  script_owned_update([], [])
}

test update_script_owner_by_signature() fail {
  // A script owner authorizes by a withdrawal, not by a key with its hash.
  script_owned_update([], [owner_script])
}

test update_keys_signatures_attributes() {
  let one: Data = 1
  spends(
    update_tx(
      Fields {
        ..active,
        keys: [],
        signatures: [Pair(#"61757261", #"")],
        attributes: [Pair(#"01", one)],
      },
      1_500_000,
      owner_key,
    ),
  )
}

test update_unchanged() {
  spends(update_tx(active, 1_500_000, pool))
}

test update_changes_crch() fail {
  spends(update_tx(Fields { ..active, crch: crch_c }, 1_500_000, pool))
}

test update_changes_prev_crch() fail {
  spends(update_tx(Fields { ..active, prev_crch: #"" }, 1_500_000, pool))
}

test update_changes_pool_id() fail {
  spends(
    update_tx(
      Fields {
        ..active,
        pool_id: #"b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1",
      },
      1_500_000,
      pool,
    ),
  )
}

test update_changes_prev_pool() fail {
  spends(update_tx(Fields { ..active, prev_pool: #"" }, 1_500_000, pool))
}

test update_changes_crch_signature() fail {
  spends(
    update_tx(Fields { ..active, crch_signature: bytes(64) }, 1_500_000, pool),
  )
}

test update_deactivates() fail {
  spends(update_tx(cleared, 1_500_000, pool))
}

test update_sets_active_false() fail {
  spends(update_tx(Fields { ..active, active: False }, 1_500_000, pool))
}

test update_inactive_node() fail {
  spends(
    Transaction {
      ..placeholder,
      inputs: [node_input(0, registration(cleared)), wallet_input],
      outputs: [node_output(1_500_000, registration(cleared)), change],
      extra_signatories: [pool],
      withdrawals: gate_withdrawal,
      redeemers: updating(),
    },
  )
}

test update_reactivates_an_inactive_node() fail {
  // An inactive node that still holds its fields (unreachable through Deactivate) cannot
  // come back.
  spends(
    Transaction {
      ..update_tx(active, 1_500_000, pool),
      inputs: [
        node_input(0, registration(Fields { ..active, active: False })),
        wallet_input,
      ],
    },
  )
}

test update_reserved_node() fail {
  let reserved = Reserved { crch: crch_c, prev_crch: crch_a }
  spends(
    Transaction {
      ..placeholder,
      inputs: [node_input(0, reserved), wallet_input],
      outputs: [node_output(1_500_000, reserved), change],
      extra_signatories: [pool],
      withdrawals: gate_withdrawal,
      redeemers: updating(),
    },
  )
}

test update_ada_falls() fail {
  spends(update_tx(active, 1_499_999, pool))
}

test update_ada_rises() {
  spends(update_tx(active, 2_000_000, pool))
}

test update_change_first() fail {
  let tx = update_tx(active, 1_500_000, pool)
  spends(
    Transaction {
      ..tx,
      outputs: [change, node_output(1_500_000, registration(active))],
    },
  )
}

test update_second_node_output() fail {
  let tx = update_tx(active, 1_500_000, pool)
  spends(
    Transaction {
      ..tx,
      outputs: list_append(
        tx.outputs,
        node_output(1_500_000, registration(active)),
      ),
    },
  )
}

test update_tokenless_output_at_address() fail {
  // Nothing but the nodes sits at the address (user decision, 11-17).
  let tx = update_tx(active, 1_500_000, pool)
  spends(
    Transaction {
      ..tx,
      outputs: list_append(
        tx.outputs,
        Output { ..change, address: Address(Script(own), None) },
      ),
    },
  )
}

test update_moves_node() fail {
  let tx = update_tx(active, 1_500_000, pool)
  spends(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..node_output(1_500_000, registration(active)),
          address: Address(Script(owner_script), None),
        },
        change,
      ],
    },
  )
}

test update_reward_address_31_bytes() fail {
  spends(
    update_tx(Fields { ..active, reward_address: bytes(31) }, 1_500_000, pool),
  )
}

test update_fixed_cost_negative() fail {
  spends(update_tx(Fields { ..active, fixed_cost: -1 }, 1_500_000, pool))
}

test update_fixed_cost_above_max() fail {
  spends(
    update_tx(
      Fields { ..active, fixed_cost: max_fixed_cost + 1 },
      1_500_000,
      pool,
    ),
  )
}

test update_new_owner_hash_27_bytes() fail {
  spends(
    update_tx(
      Fields { ..active, owner: VerificationKey(bytes(27)) },
      1_500_000,
      pool,
    ),
  )
}

/// A UTxO at the address without the token, at output index 5 of transaction #"77".
const tokenless_input =
  Input {
    output_reference: OutputReference(#"77", 5),
    output: Output { ..change, address: Address(Script(own), None) },
  }

/// The spend of the UTxO without the token, which passes the gate, and the withdrawal,
/// which refuses it.
fn spends_tokenless(tx: Transaction) -> Bool {
  let tx = Transaction { ..tx, inputs: [tokenless_input, ..tx.inputs] }
  and {
    gate(tx, Spending { output: OutputReference(#"77", 5), datum: None }),
    withdraws(tx),
  }
}

test spend_tokenless_utxo_at_address() fail {
  // Rule 9 (user decision, 11-16): a UTxO at the address without the token is unspendable.
  spends_tokenless(
    Transaction {
      ..placeholder,
      outputs: [change],
      withdrawals: gate_withdrawal,
      redeemers: updating(),
    },
  )
}

test spend_tokenless_utxo_beside_an_update() fail {
  spends_tokenless(update_tx(active, 1_500_000, pool))
}

test spend_tokenless_utxo_beside_a_create() fail {
  spends_tokenless(create_7b())
}

test spend_tokenless_utxo_with_a_stake_part() fail {
  // Rule 9: the payment credential decides, whatever the stake part.
  spends_tokenless(
    Transaction {
      ..update_tx(active, 1_500_000, pool),
      inputs: [
        Input {
          ..tokenless_input,
          output: Output {
            ..tokenless_input.output,
            address: Address(Script(own), Some(Inline(VerificationKey(staker)))),
          },
        },
        node_input(0, registration(active)),
        wallet_input,
      ],
    },
  )
}

test spend_with_a_burn() fail {
  // An Update mints and burns nothing (user decision, 11-17); the mint purpose rejects the
  // burn too (burn_a_node).
  spends(
    Transaction {
      ..update_tx(active, 1_500_000, pool),
      mint: assets.from_asset(own, "", -1),
    },
  )
}

test burn_a_node() fail {
  mints(
    Transaction {
      ..placeholder,
      inputs: [node_input(0, registration(active))],
      outputs: [change],
      mint: assets.from_asset(own, "", -1),
      extra_signatories: [pool],
      withdrawals: gate_withdrawal,
      redeemers: acting(CreateOneAnchor),
    },
  )
}

// Deactivate (diagram 9): the Tail, after the node in the pool list, is its anchor.

const anchor_before = Tail { prev_crch: crch_b, prev_pool: pool }

const anchor_after = Tail { prev_crch: crch_b, prev_pool: pool_a }

fn deactivate_tx(outputs: List<Output>) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [node_input(0, registration(active)), node_input(1, anchor_before)],
    outputs,
    extra_signatories: [pool],
    withdrawals: gate_withdrawal,
    redeemers: acting(Deactivate),
  }
}

/// A Deactivate whose node output holds `after` and whose anchor output holds
/// `anchor` with `anchor_lovelace`.
fn deactivates(after: Fields, anchor: Node, anchor_lovelace: Int) -> Bool {
  spends(
    deactivate_tx(
      [
        node_output(1_000_000, registration(after)),
        node_output(anchor_lovelace, anchor),
        change,
      ],
    ),
  )
}

test deactivate_under_cold_key() {
  deactivates(cleared, anchor_after, 1_500_000)
}

test deactivate_run_by_the_anchor_spend() {
  let tx =
    deactivate_tx(
      [
        node_output(1_000_000, registration(cleared)),
        node_output(1_500_000, anchor_after),
      ],
    )
  and {
    gate(tx, Spending { output: OutputReference(#"77", 1), datum: None }),
    withdraws(tx),
  }
}

test deactivate_inputs_other_order() {
  spends(
    Transaction {
      ..deactivate_tx(
        [
          node_output(1_000_000, registration(cleared)),
          node_output(1_500_000, anchor_after),
        ],
      ),
      inputs: [
        node_input(1, anchor_before),
        node_input(0, registration(active)),
      ],
    },
  )
}

test deactivate_with_a_registration_anchor() {
  // The active node of pool_c, after the node in the pool list.
  let anchor =
    Fields {
      ..active,
      crch: crch_c,
      prev_crch: crch_b,
      pool_id: pool_c,
      prev_pool: pool,
    }
  spends(
    Transaction {
      ..deactivate_tx(
        [
          node_output(1_000_000, registration(cleared)),
          node_output(
            1_500_000,
            registration(Fields { ..anchor, prev_pool: pool_a }),
          ),
        ],
      ),
      inputs: [
        node_input(0, registration(active)),
        node_input(1, registration(anchor)),
      ],
    },
  )
}

test deactivate_under_owner() fail {
  spends(
    Transaction {
      ..deactivate_tx(
        [
          node_output(1_000_000, registration(cleared)),
          node_output(1_500_000, anchor_after),
        ],
      ),
      extra_signatories: [owner_key],
    },
  )
}

test deactivate_anchor_first() fail {
  spends(
    deactivate_tx(
      [
        node_output(1_500_000, anchor_after),
        node_output(1_000_000, registration(cleared)),
      ],
    ),
  )
}

test deactivate_change_first() fail {
  spends(
    deactivate_tx(
      [
        change,
        node_output(1_000_000, registration(cleared)),
        node_output(1_500_000, anchor_after),
      ],
    ),
  )
}

test deactivate_leaves_active() fail {
  deactivates(Fields { ..cleared, active: True }, anchor_after, 1_500_000)
}

test deactivate_changes_crch() fail {
  deactivates(Fields { ..cleared, crch: crch_c }, anchor_after, 1_500_000)
}

test deactivate_changes_prev_crch() fail {
  deactivates(Fields { ..cleared, prev_crch: #"" }, anchor_after, 1_500_000)
}

test deactivate_leaves_pool_id() fail {
  deactivates(Fields { ..cleared, pool_id: pool }, anchor_after, 1_500_000)
}

test deactivate_leaves_prev_pool() fail {
  deactivates(Fields { ..cleared, prev_pool: pool_a }, anchor_after, 1_500_000)
}

test deactivate_leaves_owner() fail {
  deactivates(
    Fields { ..cleared, owner: VerificationKey(owner_key) },
    anchor_after,
    1_500_000,
  )
}

test deactivate_owner_script_empty() fail {
  deactivates(Fields { ..cleared, owner: Script(#"") }, anchor_after, 1_500_000)
}

test deactivate_leaves_crch_signature() fail {
  deactivates(Fields { ..cleared, crch_signature }, anchor_after, 1_500_000)
}

test deactivate_leaves_keys() fail {
  deactivates(
    Fields { ..cleared, keys: [Pair(#"61757261", #"")] },
    anchor_after,
    1_500_000,
  )
}

test deactivate_leaves_signatures() fail {
  deactivates(
    Fields { ..cleared, signatures: [Pair(#"61757261", #"")] },
    anchor_after,
    1_500_000,
  )
}

test deactivate_leaves_reward_address() fail {
  deactivates(
    Fields { ..cleared, reward_address: reward },
    anchor_after,
    1_500_000,
  )
}

test deactivate_leaves_fixed_cost() fail {
  deactivates(Fields { ..cleared, fixed_cost: 1 }, anchor_after, 1_500_000)
}

test deactivate_leaves_attributes() fail {
  let one: Data = 1
  deactivates(
    Fields { ..cleared, attributes: [Pair(#"01", one)] },
    anchor_after,
    1_500_000,
  )
}

test deactivate_node_ada_falls() {
  // The deactivated node holds the least ADA; only the anchor's may not fall.
  deactivates(cleared, anchor_after, 1_500_000)
}

test deactivate_anchor_keeps_link() fail {
  deactivates(cleared, anchor_before, 1_500_000)
}

test deactivate_anchor_changes_crch_link() fail {
  deactivates(cleared, Tail { prev_crch: crch_c, prev_pool: pool_a }, 1_500_000)
}

test deactivate_anchor_ada_falls() fail {
  deactivates(cleared, anchor_after, 1_499_999)
}

test deactivate_with_a_non_anchor() fail {
  // The Tail does not link to the node in the pool list.
  spends(
    Transaction {
      ..deactivate_tx(
        [
          node_output(1_000_000, registration(cleared)),
          node_output(1_500_000, anchor_after),
        ],
      ),
      inputs: [node_input(0, registration(active)), node_input(1, anchor_after)],
    },
  )
}

test deactivate_with_reserved_anchor() fail {
  let reserved = Reserved { crch: crch_c, prev_crch: crch_b }
  spends(
    Transaction {
      ..deactivate_tx(
        [
          node_output(1_000_000, registration(cleared)),
          node_output(1_500_000, reserved),
        ],
      ),
      inputs: [node_input(0, registration(active)), node_input(1, reserved)],
    },
  )
}

test deactivate_an_inactive_node() fail {
  spends(
    Transaction {
      ..deactivate_tx(
        [
          node_output(1_000_000, registration(cleared)),
          node_output(1_500_000, anchor_after),
        ],
      ),
      inputs: [
        node_input(0, registration(cleared)),
        node_input(1, anchor_before),
      ],
    },
  )
}

test deactivate_an_inactive_node_with_fields() fail {
  // An inactive node that still holds its fields (unreachable through Deactivate), linked
  // from the anchor.
  spends(
    Transaction {
      ..deactivate_tx(
        [
          node_output(1_000_000, registration(cleared)),
          node_output(1_500_000, anchor_after),
        ],
      ),
      inputs: [
        node_input(0, registration(Fields { ..active, active: False })),
        node_input(1, anchor_before),
      ],
    },
  )
}

test deactivate_third_node_output() fail {
  spends(
    deactivate_tx(
      [
        node_output(1_000_000, registration(cleared)),
        node_output(1_500_000, anchor_after),
        node_output(1_500_000, Reserved { crch: crch_d, prev_crch: crch_c }),
      ],
    ),
  )
}

test three_nodes_spent() fail {
  let tx =
    deactivate_tx(
      [
        node_output(1_000_000, registration(cleared)),
        node_output(1_500_000, anchor_after),
      ],
    )
  spends(
    Transaction {
      ..tx,
      inputs: [
        node_input(2, Reserved { crch: crch_d, prev_crch: crch_c }),
        ..tx.inputs
      ],
    },
  )
}

test else_purpose_fails() fail {
  gate(
    placeholder,
    Publishing {
      at: 0,
      certificate: UnregisterCredential {
        credential: Script(own),
        refund: Never,
      },
    },
  )
}

// Gate: the mint and the spend need the withdrawal from night_registration, and the
// withdrawal runs every rule (user decision, 11-17).

test mint_without_the_withdrawal() fail {
  gate(Transaction { ..valid_init(), withdrawals: [] }, Minting(own))
}

test spend_without_the_withdrawal() fail {
  gate(
    Transaction { ..valid_update(), withdrawals: [] },
    Spending { output: OutputReference(#"77", 0), datum: None },
  )
}

test mint_and_spend_gates_pass_with_the_withdrawal() {
  and {
    gate(valid_init(), Minting(own)),
    gate(
      valid_update(),
      Spending { output: OutputReference(#"77", 0), datum: None },
    ),
  }
}

test publish_registration() {
  gate(
    placeholder,
    Publishing {
      at: 0,
      certificate: RegisterCredential {
        credential: Script(own),
        deposit: Never,
      },
    },
  )
}

test publish_delegation() fail {
  gate(
    placeholder,
    Publishing {
      at: 0,
      certificate: DelegateCredential {
        credential: Script(own),
        delegate: DelegateBlockProduction(pool),
      },
    },
  )
}

// Exact values: a node padded with one junk token is refused, spent or created.

const junk = #"f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0"

fn padded(output: Output) -> Output {
  Output { ..output, value: output.value |> assets.add(junk, "", 1) }
}

test init_node_padded() fail {
  expect [first, ..rest] = init_nodes()
  mints(init_tx([padded(first), ..rest], 3))
}

test create_anchor_output_padded() fail {
  mints(
    create_tx(
      [node_input(0, tail_before)],
      registration(active),
      [padded(node_output(1_500_000, tail_after))],
    ),
  )
}

test create_anchor_input_padded() fail {
  let anchor = node_input(0, tail_before)
  mints(
    create_tx(
      [Input { ..anchor, output: padded(anchor.output) }],
      registration(active),
      [node_output(1_500_000, tail_after)],
    ),
  )
}

test update_node_input_padded() fail {
  let tx = update_tx(changed, 1_500_000, owner_key)
  expect [node, ..rest] = tx.inputs
  spends(
    Transaction {
      ..tx,
      inputs: [Input { ..node, output: padded(node.output) }, ..rest],
    },
  )
}

test update_output_padded() fail {
  let tx = update_tx(changed, 1_500_000, owner_key)
  expect [node, ..rest] = tx.outputs
  spends(Transaction { ..tx, outputs: [padded(node), ..rest] })
}

test deactivate_anchor_input_padded() fail {
  let tx =
    deactivate_tx(
      [
        node_output(1_000_000, registration(cleared)),
        node_output(1_500_000, anchor_after),
      ],
    )
  let anchor = node_input(1, anchor_before)
  spends(
    Transaction {
      ..tx,
      inputs: [
        node_input(0, registration(active)),
        Input { ..anchor, output: padded(anchor.output) },
      ],
    },
  )
}

// Redeemer (user decision, 11-17): the redeemer names the action, and each action accepts
// one transaction shape. Every valid transaction below is refused under each other action.

fn valid_init() -> Transaction {
  init_tx(init_nodes(), 3)
}

fn valid_update() -> Transaction {
  update_tx(changed, 1_500_000, owner_key)
}

fn valid_deactivate() -> Transaction {
  deactivate_tx(
    [
      node_output(1_000_000, registration(cleared)),
      node_output(1_500_000, anchor_after),
    ],
  )
}

/// The transaction with `action` as its withdrawal's redeemer.
fn as_action(tx: Transaction, action: RegistrationAction) -> Transaction {
  Transaction { ..tx, redeemers: acting(action) }
}

test valid_transactions_pass() {
  and {
    mints(valid_init()),
    mints(create_7b()),
    mints(valid_create_two()),
    spends(valid_update()),
    spends(valid_deactivate()),
  }
}

test init_as_create_one_anchor() fail {
  withdraws(as_action(valid_init(), CreateOneAnchor))
}

test init_as_create_two_anchors() fail {
  withdraws(as_action(valid_init(), CreateTwoAnchors))
}

test init_as_update() fail {
  withdraws(as_action(valid_init(), Update))
}

test init_as_deactivate() fail {
  withdraws(as_action(valid_init(), Deactivate))
}

test create_one_anchor_as_init() fail {
  withdraws(as_action(create_7b(), Init))
}

test create_one_anchor_as_create_two_anchors() fail {
  withdraws(as_action(create_7b(), CreateTwoAnchors))
}

test create_one_anchor_as_update() fail {
  withdraws(as_action(create_7b(), Update))
}

test create_one_anchor_as_deactivate() fail {
  withdraws(as_action(create_7b(), Deactivate))
}

fn valid_create_two() -> Transaction {
  create_7a(
    node_output(1_500_000, reserved_after),
    node_output(1_500_000, tail_7a_after),
  )
}

test create_two_anchors_as_init() fail {
  withdraws(as_action(valid_create_two(), Init))
}

test create_two_anchors_as_create_one_anchor() fail {
  withdraws(as_action(valid_create_two(), CreateOneAnchor))
}

test create_two_anchors_as_update() fail {
  withdraws(as_action(valid_create_two(), Update))
}

test create_two_anchors_as_deactivate() fail {
  withdraws(as_action(valid_create_two(), Deactivate))
}

test update_as_init() fail {
  withdraws(as_action(valid_update(), Init))
}

test update_as_create_one_anchor() fail {
  withdraws(as_action(valid_update(), CreateOneAnchor))
}

test update_as_create_two_anchors() fail {
  withdraws(as_action(valid_update(), CreateTwoAnchors))
}

test update_as_deactivate() fail {
  withdraws(as_action(valid_update(), Deactivate))
}

test deactivate_as_init() fail {
  withdraws(as_action(valid_deactivate(), Init))
}

test deactivate_as_create_one_anchor() fail {
  withdraws(as_action(valid_deactivate(), CreateOneAnchor))
}

test deactivate_as_create_two_anchors() fail {
  withdraws(as_action(valid_deactivate(), CreateTwoAnchors))
}

test deactivate_as_update() fail {
  withdraws(as_action(valid_deactivate(), Update))
}

// Shape: one node spent more, placed last among the inputs, or one output more at the
// address, is refused.

const extra_node = Reserved { crch: crch_d, prev_crch: crch_c }

test create_third_node_spent_last() fail {
  let tx =
    create_7a(
      node_output(1_500_000, reserved_after),
      node_output(1_500_000, tail_7a_after),
    )
  mints(
    Transaction {
      ..tx,
      inputs: list_append(tx.inputs, node_input(2, extra_node)),
    },
  )
}

test create_one_anchor_second_node_spent_last() fail {
  let tx = create_7b()
  mints(
    Transaction {
      ..tx,
      inputs: list_append(tx.inputs, node_input(2, extra_node)),
    },
  )
}

test update_second_node_spent_last() fail {
  let tx = valid_update()
  spends(
    Transaction {
      ..tx,
      inputs: list_append(tx.inputs, node_input(2, extra_node)),
    },
  )
}

test deactivate_third_node_spent_last() fail {
  let tx = valid_deactivate()
  spends(
    Transaction {
      ..tx,
      inputs: list_append(tx.inputs, node_input(2, extra_node)),
    },
  )
}

test create_tokenless_output_at_address() fail {
  let tx = create_7b()
  mints(
    Transaction {
      ..tx,
      outputs: list_append(
        tx.outputs,
        Output { ..change, address: Address(Script(own), None) },
      ),
    },
  )
}

test init_with_change_after() {
  mints(init_tx(list_append(init_nodes(), change), 3))
}

test init_change_first() fail {
  // The nodes are the first outputs (user decision, 11-17).
  mints(init_tx([change, ..init_nodes()], 3))
}

test create_anchor_without_the_token() fail {
  // An input at the address that holds ADA and another token is not a node.
  let anchor = node_input(0, tail_before)
  mints(
    create_tx(
      [
        Input {
          ..anchor,
          output: Output {
            ..anchor.output,
            value: assets.from_lovelace(1_500_000) |> assets.add(junk, "", 1),
          },
        },
      ],
      registration(active),
      [node_output(1_500_000, tail_after)],
    ),
  )
}

test init_two_tails() fail {
  mints(
    init_tx(
      [
        node_output(1_500_000, Tail { prev_crch: #"", prev_pool: #"" }),
        node_output(1_500_000, Tail { prev_crch: #"", prev_pool: #"" }),
      ],
      2,
    ),
  )
}

test init_lone_reserved_with_empty_crch() fail {
  mints(
    init_tx([node_output(1_500_000, Reserved { crch: #"", prev_crch: #"" })], 1),
  )
}

test init_without_a_tail() fail {
  mints(
    init_tx(
      [node_output(1_500_000, Reserved { crch: crch_a, prev_crch: #"" })],
      1,
    ),
  )
}

test init_token_at_another_address() fail {
  mints(
    init_tx(
      list_append(
        init_nodes(),
        Output { ..change, value: change.value |> assets.add(own, "", 1) },
      ),
      3,
    ),
  )
}

test deactivate_mints_a_token() fail {
  let tx = valid_deactivate()
  spends(Transaction { ..tx, mint: assets.from_asset(own, "", 1) })
}

test deactivate_node_with_31_byte_crch() {
  let tx = valid_deactivate()
  spends(
    Transaction {
      ..tx,
      inputs: [
        node_input(0, registration(Fields { ..active, crch: bytes(31) })),
        node_input(1, anchor_before),
      ],
      outputs: [
        node_output(
          1_000_000,
          registration(Fields { ..cleared, crch: bytes(31) }),
        ),
        node_output(1_500_000, anchor_after),
      ],
    },
  )
}

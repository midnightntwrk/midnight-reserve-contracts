// Unit tests for night_staking: the contract test list of the staking MIP (PR 421) as the
// user's decisions change it, and the boundary vectors of Acceptance Criterion 2.

use aiken/collection/list
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{Address, Credential, Inline, Script, VerificationKey}
use cardano/assets.{Value}
use cardano/certificate.{
  DelegateBlockProduction, DelegateCredential, RegisterCredential,
  UnregisterCredential,
}
use cardano/governance.{DelegateRepresentative}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, ScriptInfo, Spending, Voting, Withdrawing,
}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, Withdraw,
  placeholder,
}
use config
use night_staking.{DelegationLock, Lock, StakingAction, Unbond, Unlock, Update}
use registration/types.{Registration}

const own = #"5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e"

const key = #"0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a"

const other_key = #"0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c"

const owner_script = #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"

const pool = #"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"

const other_pool = #"b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1"

const reward =
  #"d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0"

const other_reward =
  #"d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1"

const foreign = #"f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0"

/// The key and script behind the return addresses the tests use.
const return_key = #"0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e"

const other_return_key =
  #"0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f"

const return_script =
  #"0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d"

const returns = Address(VerificationKey(return_key), None)

const other_returns = Address(VerificationKey(other_return_key), None)

const deposit = config.lock_deposit_lovelace

const delay = config.unbonding_delay_ms

/// The unbond time the tests use, and a validity interval around it.
const t = 1_800_000_600_000

const staking =
  DelegationLock {
    owner: VerificationKey(key),
    pool_id: pool,
    reward_address: reward,
    return_address: returns,
    unbond_at: None,
    attributes: [],
  }

const unbonding = DelegationLock { ..staking, unbond_at: Some(t) }

fn value(lovelace: Int, token: Int, cnight: Int) -> Value {
  assets.from_lovelace(lovelace)
    |> assets.add(own, "", token)
    |> assets.add(config.cnight_policy, config.cnight_name, cnight)
}

/// A node of the registration set for `pool_id` (rule 2, Output), read as a reference input.
fn registered(pool_id: ByteArray, active: Bool) -> Input {
  let hash = config.night_registration_hash
  Input {
    output_reference: OutputReference(#"aa", 0),
    output: Output {
      address: Address(Script(hash), None),
      value: assets.from_lovelace(2_000_000) |> assets.add(hash, "", 1),
      datum: InlineDatum(
        Registration {
          active,
          crch: bytes(32),
          prev_crch: "",
          pool_id,
          prev_pool: "",
          owner: VerificationKey(key),
          crch_signature: bytes(64),
          keys: [],
          signatures: [],
          reward_address: reward,
          fixed_cost: 0,
          attributes: [],
        },
      ),
      reference_script: None,
    },
  }
}

fn lock_output(lovelace: Int, cnight: Int, lock: DelegationLock) -> Output {
  Output {
    address: Address(Script(own), None),
    value: value(lovelace, 1, cnight),
    datum: InlineDatum(lock),
    reference_script: None,
  }
}

fn lock_input(lovelace: Int, cnight: Int, lock: DelegationLock) -> Input {
  Input {
    output_reference: OutputReference(#"01", 0),
    output: lock_output(lovelace, cnight, lock),
  }
}

/// The withdrawal redeemer that names `action`.
fn acting(action: StakingAction) -> Pairs<transaction.ScriptPurpose, Data> {
  [Pair(Withdraw(Script(own)), as_data(action))]
}

/// A Lock signed by `key`, with the gate withdrawal, reading `pool`'s active node.
fn lock_tx(output: Output, minted: Value) -> Transaction {
  Transaction {
    ..placeholder,
    outputs: [output],
    reference_inputs: [registered(pool, True)],
    mint: minted,
    extra_signatories: [key],
    withdrawals: [Pair(Script(own), 0)],
    redeemers: acting(Lock),
  }
}

/// An Update of one lock, signed by `key`, with the gate withdrawal, valid until t, reading
/// `pool`'s active node.
fn update_tx(input: Input, output: Output) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [input],
    outputs: [output],
    reference_inputs: [registered(pool, True)],
    extra_signatories: [key],
    withdrawals: [Pair(Script(own), 0)],
    validity_range: interval.between(t - 600_000, t),
    redeemers: acting(Update),
  }
}

/// The same transaction as update_tx, as an Unbond.
fn unbond_tx(input: Input, output: Output) -> Transaction {
  Transaction { ..update_tx(input, output), redeemers: acting(Unbond) }
}

/// An Unlock of one lock at POSIX time `lower`, signed by `key`, with the gate withdrawal.
fn unlock_tx(input: Input, lower: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [input],
    outputs: [
      Output {
        address: returns,
        value: assets.without_lovelace(input.output.value)
          |> assets.add(own, "", -1)
          |> assets.merge(assets.from_lovelace(5_000_000)),
        datum: NoDatum,
        reference_script: None,
      },
    ],
    mint: assets.from_asset(own, "", -1),
    extra_signatories: [key],
    withdrawals: [Pair(Script(own), 0)],
    validity_range: interval.after(lower),
    redeemers: acting(Unlock),
  }
}

fn run(tx: Transaction, info: ScriptInfo) -> Bool {
  night_staking.night_staking.else(
    ScriptContext { transaction: tx, redeemer: Void, info },
  )
}

/// The withdrawal, with the redeemer the transaction carries for it, as the ledger passes it.
fn withdraw(tx: Transaction) -> Bool {
  expect Some(Pair(_, redeemer)) =
    list.find(tx.redeemers, fn(pair) { pair.1st == Withdraw(Script(own)) })
  night_staking.night_staking.else(
    ScriptContext { transaction: tx, redeemer, info: Withdrawing(Script(own)) },
  )
}

/// A Lock of `lock` that its owner authorizes, whatever the owner, so only rules 1 and 2 decide.
fn locks(lock: DelegationLock) -> Bool {
  let owner_hash =
    when lock.owner is {
      VerificationKey(hash) -> hash
      Script(hash) -> hash
    }
  let tx =
    lock_tx(lock_output(deposit, 1_000, lock), assets.from_asset(own, "", 1))
  withdraw(
    Transaction {
      ..tx,
      extra_signatories: [owner_hash],
      reference_inputs: [registered(lock.pool_id, True)],
      withdrawals: [Pair(lock.owner, 0), Pair(Script(own), 0)],
    },
  )
}

fn updates(after: DelegationLock) -> Bool {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, after),
    )
  withdraw(
    Transaction { ..tx, reference_inputs: [registered(after.pool_id, True)] },
  )
}

fn unbonds(after: DelegationLock) -> Bool {
  withdraw(
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, after),
    ),
  )
}

fn bytes(n: Int) -> ByteArray {
  if n == 0 {
    ""
  } else {
    #"aa" |> bytearray.concat(bytes(n - 1))
  }
}

// Datum (rule 2): owner, pool_id and reward_address lengths, and owner not the script.

test lock_owner_hash_27_bytes() fail {
  locks(DelegationLock { ..staking, owner: VerificationKey(bytes(27)) })
}

test lock_owner_hash_28_bytes() {
  locks(staking)
}

test lock_owner_hash_29_bytes() fail {
  locks(DelegationLock { ..staking, owner: VerificationKey(bytes(29)) })
}

test lock_owner_script_hash_27_bytes() fail {
  locks(DelegationLock { ..staking, owner: Script(bytes(27)) })
}

test lock_owner_night_staking() fail {
  locks(DelegationLock { ..staking, owner: Script(own) })
}

test lock_pool_id_27_bytes() fail {
  locks(DelegationLock { ..staking, pool_id: bytes(27) })
}

test lock_pool_id_28_bytes() {
  locks(DelegationLock { ..staking, pool_id: bytes(28) })
}

test lock_pool_id_29_bytes() fail {
  locks(DelegationLock { ..staking, pool_id: bytes(29) })
}

test lock_reward_address_31_bytes() fail {
  locks(DelegationLock { ..staking, reward_address: bytes(31) })
}

test lock_reward_address_32_bytes() {
  locks(DelegationLock { ..staking, reward_address: bytes(32) })
}

test lock_reward_address_33_bytes() fail {
  locks(DelegationLock { ..staking, reward_address: bytes(33) })
}

test update_pool_id_27_bytes() fail {
  updates(DelegationLock { ..staking, pool_id: bytes(27) })
}

test update_reward_address_33_bytes() fail {
  updates(DelegationLock { ..staking, reward_address: bytes(33) })
}

// Datum (rule 2): the return address's payment credential holds a 28-byte hash and is not
// the script; its stake part is free.

test lock_return_address_night_staking() fail {
  locks(
    DelegationLock { ..staking, return_address: Address(Script(own), None) },
  )
}

test lock_return_address_hash_27_bytes() fail {
  locks(
    DelegationLock {
      ..staking,
      return_address: Address(VerificationKey(bytes(27)), None),
    },
  )
}

test lock_return_address_script_hash_29_bytes() fail {
  locks(
    DelegationLock {
      ..staking,
      return_address: Address(Script(bytes(29)), None),
    },
  )
}

test lock_return_address_script() {
  locks(
    DelegationLock {
      ..staking,
      return_address: Address(Script(return_script), None),
    },
  )
}

test lock_return_address_with_stake_part() {
  locks(
    DelegationLock {
      ..staking,
      return_address: Address(
        VerificationKey(return_key),
        Some(Inline(VerificationKey(key))),
      ),
    },
  )
}

test update_return_address_night_staking() fail {
  // Signed by the owner and the input's return key, so only rule 2 decides.
  updates_under(
    staking,
    DelegationLock { ..staking, return_address: Address(Script(own), None) },
    [key, return_key],
    [],
  )
}

test lock_without_inline_datum() fail {
  withdraw(
    lock_tx(
      Output { ..lock_output(deposit, 0, staking), datum: NoDatum },
      assets.from_asset(own, "", 1),
    ),
  )
}

test lock_datum_not_a_delegation_lock() fail {
  let garbage: Data = 42
  withdraw(
    lock_tx(
      Output { ..lock_output(deposit, 0, staking), datum: InlineDatum(garbage) },
      assets.from_asset(own, "", 1),
    ),
  )
}

test lock_unbonding() fail {
  locks(unbonding)
}

// Pool (rules 2 and 3): a Lock, and an Update that changes pool_id, read the pool's active
// registration node.

fn lock_reading(reference_inputs: List<Input>) -> Bool {
  let tx =
    lock_tx(lock_output(deposit, 1_000, staking), assets.from_asset(own, "", 1))
  withdraw(Transaction { ..tx, reference_inputs })
}

test lock_reads_active_pool_node() {
  lock_reading([registered(pool, True)])
}

test lock_without_pool_node() fail {
  lock_reading([])
}

test lock_inactive_pool_node() fail {
  lock_reading([registered(pool, False)])
}

test lock_other_pool_node() fail {
  lock_reading([registered(other_pool, True)])
}

test lock_tokenless_look_alike_node() fail {
  let node = registered(pool, True)
  lock_reading(
    [
      Input {
        ..node,
        output: Output { ..node.output, value: assets.from_lovelace(2_000_000) },
      },
    ],
  )
}

test lock_node_at_another_address() fail {
  let node = registered(pool, True)
  lock_reading(
    [
      Input {
        ..node,
        output: Output {
          ..node.output,
          address: Address(Script(owner_script), None),
        },
      },
    ],
  )
}

test update_keeps_pool_id_without_pool_node() {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  withdraw(Transaction { ..tx, reference_inputs: [] })
}

fn re_points(reference_inputs: List<Input>) -> Bool {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(
        deposit,
        1_000,
        DelegationLock { ..staking, pool_id: other_pool },
      ),
    )
  withdraw(Transaction { ..tx, reference_inputs })
}

test update_re_points_with_new_pool_node() {
  re_points([registered(other_pool, True)])
}

test update_re_points_without_pool_node() fail {
  re_points([])
}

test update_re_points_with_old_pool_node() fail {
  re_points([registered(pool, True)])
}

test update_re_points_to_inactive_pool() fail {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(
        deposit,
        1_000,
        DelegationLock { ..staking, pool_id: other_pool },
      ),
    )
  withdraw(
    Transaction {
      ..tx,
      reference_inputs: [registered(pool, True), registered(other_pool, False)],
    },
  )
}

test unbond_without_pool_node() {
  let tx =
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, unbonding),
    )
  withdraw(Transaction { ..tx, reference_inputs: [] })
}

test unlock_without_pool_node() {
  withdraw(unlock_tx(lock_input(deposit, 1_000, unbonding), t + delay))
}

// Attributes: the contract does not check them.

test lock_repeated_attribute_name() {
  // Attribute values are Data; a module constant typed Data does not compile here.
  let one: Data = 1
  let two: Data = 2
  locks(
    DelegationLock { ..staking, attributes: [Pair("a", one), Pair("a", two)] },
  )
}

test lock_unknown_attribute_names() {
  let one: Data = 1
  let ff: Data = #"ff"
  locks(
    DelegationLock { ..staking, attributes: [Pair("a", one), Pair("b", ff)] },
  )
}

test update_changes_attributes() {
  let one: Data = 1
  updates(DelegationLock { ..staking, attributes: [Pair("a", one)] })
}

test update_changes_pool_id() {
  updates(DelegationLock { ..staking, pool_id: other_pool })
}

test update_changes_reward_address() {
  updates(DelegationLock { ..staking, reward_address: other_reward })
}

test update_changes_owner() fail {
  updates(DelegationLock { ..staking, owner: VerificationKey(other_key) })
}

/// An Update or Unbond of `before` into `after` under the given signers and withdrawals,
/// beside the gate withdrawal.
fn updates_under(
  before: DelegationLock,
  after: DelegationLock,
  signers: List<ByteArray>,
  withdrawals: Pairs<Credential, Int>,
) -> Bool {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, before),
      lock_output(deposit, 1_000, after),
    )
  withdraw(
    Transaction {
      ..tx,
      extra_signatories: signers,
      withdrawals: [Pair(Script(own), 0), ..withdrawals],
    },
  )
}

// Return address (rule 3): an Update changes return_address only under the input return
// address's payment credential, and still under the owner.

test update_changes_return_address_under_owner_alone() fail {
  updates_under(
    staking,
    DelegationLock { ..staking, return_address: other_returns },
    [key],
    [],
  )
}

test update_changes_return_address_under_owner_and_return_key() {
  updates_under(
    staking,
    DelegationLock { ..staking, return_address: other_returns },
    [key, return_key],
    [],
  )
}

test update_changes_return_address_under_return_key_alone() fail {
  updates_under(
    staking,
    DelegationLock { ..staking, return_address: other_returns },
    [return_key],
    [],
  )
}

test update_changes_return_address_under_the_new_return_key() fail {
  updates_under(
    staking,
    DelegationLock { ..staking, return_address: other_returns },
    [key, other_return_key],
    [],
  )
}

test update_changes_return_stake_part_under_owner_alone() fail {
  updates_under(
    staking,
    DelegationLock {
      ..staking,
      return_address: Address(
        VerificationKey(return_key),
        Some(Inline(VerificationKey(key))),
      ),
    },
    [key],
    [],
  )
}

test update_changes_script_return_address_with_its_withdrawal() {
  let before =
    DelegationLock {
      ..staking,
      return_address: Address(Script(return_script), None),
    }
  updates_under(
    before,
    DelegationLock { ..before, return_address: other_returns },
    [key],
    [Pair(Script(return_script), 0)],
  )
}

test update_changes_script_return_address_without_its_withdrawal() fail {
  let before =
    DelegationLock {
      ..staking,
      return_address: Address(Script(return_script), None),
    }
  updates_under(
    before,
    DelegationLock { ..before, return_address: other_returns },
    [key, return_script],
    [],
  )
}

// cNIGHT.

test lock_with_cnight() {
  locks(staking)
}

test lock_without_cnight() {
  withdraw(
    lock_tx(lock_output(deposit, 0, staking), assets.from_asset(own, "", 1)),
  )
}

test update_adds_cnight() {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_001, staking),
    ),
  )
}

test update_keeps_cnight() {
  updates(staking)
}

test update_removes_one_star() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 999, staking),
    ),
  )
}

test update_removes_all_cnight() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 0, staking),
    ),
  )
}

// Unbond (rule 3).

test unbond_at_upper_bound() {
  unbonds(unbonding)
}

test unbond_one_ms_above_upper_bound() fail {
  unbonds(DelegationLock { ..staking, unbond_at: Some(t + 1) })
}

test unbond_one_ms_below_upper_bound() fail {
  unbonds(DelegationLock { ..staking, unbond_at: Some(t - 1) })
}

test unbond_without_upper_bound() fail {
  let tx =
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, unbonding),
    )
  withdraw(Transaction { ..tx, validity_range: interval.after(t - 600_000) })
}

test unbond_also_changes_owner() fail {
  // Signed by both owners: an Unbond changes nothing but unbond_at.
  let tx =
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(
        deposit,
        1_000,
        DelegationLock { ..unbonding, owner: VerificationKey(other_key) },
      ),
    )
  withdraw(Transaction { ..tx, extra_signatories: [key, other_key] })
}

test unbond_also_changes_pool_id() fail {
  unbonds(DelegationLock { ..unbonding, pool_id: other_pool })
}

test unbond_also_changes_reward_address() fail {
  unbonds(DelegationLock { ..unbonding, reward_address: other_reward })
}

test unbond_also_changes_attributes() fail {
  let one: Data = 1
  unbonds(DelegationLock { ..unbonding, attributes: [Pair("a", one)] })
}

test unbond_also_changes_return_address() fail {
  // Under the owner and the input's return key: an Unbond changes nothing but unbond_at.
  let tx =
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(
        deposit,
        1_000,
        DelegationLock { ..unbonding, return_address: other_returns },
      ),
    )
  withdraw(Transaction { ..tx, extra_signatories: [key, return_key] })
}

test unbond_also_adds_cnight() fail {
  withdraw(
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_001, unbonding),
    ),
  )
}

test unbond_with_more_ada() {
  withdraw(
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit + 100_000, 1_000, unbonding),
    ),
  )
}

test unbond_with_less_ada() fail {
  withdraw(
    unbond_tx(
      lock_input(deposit + 100_000, 1_000, staking),
      lock_output(deposit + 99_999, 1_000, unbonding),
    ),
  )
}

test unbond_with_more_ada_and_less_cnight() fail {
  withdraw(
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit + 100_000, 999, unbonding),
    ),
  )
}

test unbond_with_token_quantity_2() fail {
  withdraw(
    unbond_tx(
      lock_input(deposit, 1_000, staking),
      Output {
        ..lock_output(deposit + 100_000, 1_000, unbonding),
        value: value(deposit + 100_000, 2, 1_000),
      },
    ),
  )
}

// An unbonding lock can only be unlocked.

test update_unbonding_lock_re_points_pool_id() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, unbonding),
      lock_output(
        deposit,
        1_000,
        DelegationLock { ..unbonding, pool_id: other_pool },
      ),
    ),
  )
}

test update_unbonding_lock_adds_cnight() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, unbonding),
      lock_output(deposit, 1_001, unbonding),
    ),
  )
}

test update_unbonding_lock_changes_reward_address() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, unbonding),
      lock_output(
        deposit,
        1_000,
        DelegationLock { ..unbonding, reward_address: other_reward },
      ),
    ),
  )
}

test update_unbonding_lock_unchanged() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, unbonding),
      lock_output(deposit, 1_000, unbonding),
    ),
  )
}

test update_clears_unbond_at() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, unbonding),
      lock_output(deposit, 1_000, staking),
    ),
  )
}

// Unlock (rule 4, Burn).

test unlock_with_cnight_and_no_unbond() fail {
  withdraw(unlock_tx(lock_input(deposit, 1_000, staking), t + delay))
}

test unlock_one_ms_before_delay() fail {
  withdraw(unlock_tx(lock_input(deposit, 1_000, unbonding), t + delay - 1))
}

test unlock_at_delay() {
  withdraw(unlock_tx(lock_input(deposit, 1_000, unbonding), t + delay))
}

test unlock_one_ms_after_delay() {
  withdraw(unlock_tx(lock_input(deposit, 1_000, unbonding), t + delay + 1))
}

test unlock_without_lower_bound() fail {
  let tx = unlock_tx(lock_input(deposit, 1_000, unbonding), t + delay)
  withdraw(Transaction { ..tx, validity_range: interval.everything })
}

test unlock_without_cnight_at_once() {
  withdraw(unlock_tx(lock_input(deposit, 0, staking), t))
}

test unlock_without_cnight_after_an_unbond() {
  // Before UNBONDING_DELAY has passed: a lock without cNIGHT ignores its unbond_at.
  withdraw(unlock_tx(lock_input(deposit, 0, unbonding), t))
}

test unlock_returns_deposit_and_cnight() {
  withdraw(unlock_tx(lock_input(deposit, 1_000, unbonding), t + delay))
}

test unlock_burns_two() fail {
  let tx = unlock_tx(lock_input(deposit, 0, staking), t)
  withdraw(Transaction { ..tx, mint: assets.from_asset(own, "", -2) })
}

// Payout (rule 4): a lock with cNIGHT pays all of it to its return address, in one output;
// the ADA goes anywhere.

/// The Unlock at the delay of an unbonding lock with 1,000 STAR, paying to `outputs`.
fn unlock_paying(outputs: List<Output>) -> Bool {
  let tx = unlock_tx(lock_input(deposit, 1_000, unbonding), t + delay)
  withdraw(Transaction { ..tx, outputs })
}

fn paid(address: Address, lovelace: Int, cnight: Int) -> Output {
  Output {
    address,
    value: assets.from_lovelace(lovelace)
      |> assets.add(config.cnight_policy, config.cnight_name, cnight),
    datum: NoDatum,
    reference_script: None,
  }
}

const elsewhere = Address(VerificationKey(key), None)

test unlock_pays_cnight_to_return_address_and_ada_elsewhere() {
  unlock_paying(
    [paid(returns, 1_500_000, 1_000), paid(elsewhere, 3_000_000, 0)],
  )
}

test unlock_payout_not_first() fail {
  // The cNIGHT payout is the first output (user decision, 11-17).
  unlock_paying(
    [paid(elsewhere, 3_000_000, 0), paid(returns, 1_500_000, 1_000)],
  )
}

test unlock_pays_cnight_elsewhere() fail {
  unlock_paying([paid(elsewhere, 3_000_000, 1_000)])
}

test unlock_pays_one_star_less_to_return_address() fail {
  unlock_paying([paid(returns, 3_000_000, 999), paid(elsewhere, 1_500_000, 1)])
}

test unlock_splits_cnight_across_return_outputs() fail {
  unlock_paying([paid(returns, 2_000_000, 500), paid(returns, 2_000_000, 500)])
}

test unlock_pays_return_key_with_another_stake_part() fail {
  unlock_paying(
    [
      paid(
        Address(VerificationKey(return_key), Some(Inline(VerificationKey(key)))),
        3_000_000,
        1_000,
      ),
    ],
  )
}

test unlock_without_cnight_pays_anywhere() {
  let tx = unlock_tx(lock_input(deposit, 0, staking), t)
  withdraw(Transaction { ..tx, outputs: [paid(elsewhere, 2_000_000, 0)] })
}

// An input at the address without the token cannot be spent (rule 7).
test update_input_without_token() fail {
  let input = lock_input(deposit, 1_000, staking)
  withdraw(
    update_tx(
      Input {
        ..input,
        output: Output {
          ..input.output,
          value: assets.from_lovelace(deposit)
            |> assets.add(config.cnight_policy, config.cnight_name, 1_000),
        },
      },
      lock_output(deposit, 1_000, staking),
    ),
  )
}

test unlock_input_without_token() fail {
  let input = lock_input(deposit, 0, staking)
  let tx =
    unlock_tx(
      Input {
        ..input,
        output: Output { ..input.output, value: assets.from_lovelace(deposit) },
      },
      t,
    )
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        Output {
          address: Address(VerificationKey(key), None),
          value: assets.from_lovelace(deposit),
          datum: NoDatum,
          reference_script: None,
        },
      ],
    },
  )
}

test unlock_with_token_left_at_address() fail {
  let tx = unlock_tx(lock_input(deposit, 0, staking), t)
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        Output {
          address: Address(Script(own), None),
          value: value(deposit, 1, 0),
          datum: NoDatum,
          reference_script: None,
        },
      ],
    },
  )
}

// Authorization (rule 5).

test lock_without_owner_signature() fail {
  let tx =
    lock_tx(lock_output(deposit, 0, staking), assets.from_asset(own, "", 1))
  withdraw(Transaction { ..tx, extra_signatories: [] })
}

test lock_signed_by_another_key() fail {
  let tx =
    lock_tx(lock_output(deposit, 0, staking), assets.from_asset(own, "", 1))
  withdraw(Transaction { ..tx, extra_signatories: [other_key] })
}

test update_without_owner_signature() fail {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  withdraw(Transaction { ..tx, extra_signatories: [] })
}

test unlock_without_owner_signature() fail {
  let tx = unlock_tx(lock_input(deposit, 0, staking), t)
  withdraw(Transaction { ..tx, extra_signatories: [] })
}

test lock_script_owner_with_its_withdrawal() {
  let lock = DelegationLock { ..staking, owner: Script(owner_script) }
  let tx = lock_tx(lock_output(deposit, 0, lock), assets.from_asset(own, "", 1))
  withdraw(
    Transaction {
      ..tx,
      extra_signatories: [],
      withdrawals: [Pair(Script(owner_script), 0), Pair(Script(own), 0)],
    },
  )
}

test update_script_owner_with_its_withdrawal() {
  let lock = DelegationLock { ..staking, owner: Script(owner_script) }
  let tx =
    update_tx(lock_input(deposit, 0, lock), lock_output(deposit, 0, lock))
  withdraw(
    Transaction {
      ..tx,
      extra_signatories: [],
      withdrawals: [Pair(Script(owner_script), 0), Pair(Script(own), 0)],
    },
  )
}

test update_script_owner_without_its_withdrawal() fail {
  let lock = DelegationLock { ..staking, owner: Script(owner_script) }
  let tx =
    update_tx(lock_input(deposit, 0, lock), lock_output(deposit, 0, lock))
  withdraw(Transaction { ..tx, extra_signatories: [key] })
}

test unlock_script_owner_with_its_withdrawal() {
  let lock = DelegationLock { ..staking, owner: Script(owner_script) }
  let tx = unlock_tx(lock_input(deposit, 0, lock), t)
  withdraw(
    Transaction {
      ..tx,
      extra_signatories: [],
      withdrawals: [Pair(Script(owner_script), 0), Pair(Script(own), 0)],
    },
  )
}

// Mint (rule 1).

test lock_token_name_not_empty() fail {
  let output =
    Output {
      ..lock_output(deposit, 0, staking),
      value: assets.from_lovelace(deposit) |> assets.add(own, "x", 1),
    }
  withdraw(lock_tx(output, assets.from_asset(own, "x", 1)))
}

test lock_two_tokens_minted() fail {
  withdraw(
    lock_tx(
      Output { ..lock_output(deposit, 0, staking), value: value(deposit, 2, 0) },
      assets.from_asset(own, "", 2),
    ),
  )
}

// The ledger would put a second minted token in some output, where rule 2 or 7 refuses it;
// these two refuse it by rule 1 alone.
test lock_mints_a_second_name() fail {
  withdraw(
    lock_tx(
      lock_output(deposit, 0, staking),
      assets.from_asset(own, "", 1) |> assets.add(own, "x", 1),
    ),
  )
}

test lock_mints_two_of_one_token() fail {
  withdraw(
    lock_tx(lock_output(deposit, 0, staking), assets.from_asset(own, "", 2)),
  )
}

// Value (rule 2).

test lock_ada_at_deposit() {
  withdraw(
    lock_tx(lock_output(deposit, 0, staking), assets.from_asset(own, "", 1)),
  )
}

test lock_ada_one_below_deposit() fail {
  withdraw(
    lock_tx(lock_output(deposit - 1, 0, staking), assets.from_asset(own, "", 1)),
  )
}

test update_ada_one_below_deposit() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit - 1, 1_000, staking),
    ),
  )
}

test lock_foreign_token() fail {
  let output = lock_output(deposit, 0, staking)
  withdraw(
    lock_tx(
      Output { ..output, value: output.value |> assets.add(foreign, "", 1) },
      assets.from_asset(own, "", 1),
    ),
  )
}

test lock_address_with_stake_part() fail {
  let output = lock_output(deposit, 0, staking)
  withdraw(
    lock_tx(
      Output {
        ..output,
        address: Address {
          ..output.address,
          stake_credential: Some(address.Inline(VerificationKey(key))),
        },
      },
      assets.from_asset(own, "", 1),
    ),
  )
}

test update_address_with_stake_part() fail {
  let output = lock_output(deposit, 1_000, staking)
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, staking),
      Output {
        ..output,
        address: Address {
          ..output.address,
          stake_credential: Some(address.Inline(VerificationKey(key))),
        },
      },
    ),
  )
}

// Shape (rule 7).

test two_locks_spent() fail {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  withdraw(
    Transaction {
      ..tx,
      inputs: [
        lock_input(deposit, 1_000, staking),
        Input {
          output_reference: OutputReference(#"02", 0),
          output: lock_output(deposit, 1_000, staking),
        },
      ],
    },
  )
}

test lock_and_update_in_one() fail {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        lock_output(deposit, 1_000, staking),
        lock_output(deposit, 0, staking),
      ],
      mint: assets.from_asset(own, "", 1),
    },
  )
}

test update_token_moved_to_another_address() fail {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..lock_output(deposit, 1_000, staking),
          address: Address(VerificationKey(key), None),
        },
      ],
    },
  )
}

test update_with_token_at_another_address() fail {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  let stray =
    Output {
      address: Address(VerificationKey(key), None),
      value: value(2_000_000, 1, 0),
      datum: NoDatum,
      reference_script: None,
    }
  withdraw(
    Transaction {
      ..tx,
      inputs: [
        lock_input(deposit, 1_000, staking),
        Input { output_reference: OutputReference(#"03", 0), output: stray },
      ],
      outputs: [lock_output(deposit, 1_000, staking), stray],
    },
  )
}

test withdrawal_without_spend_or_mint() fail {
  withdraw(
    Transaction {
      ..placeholder,
      extra_signatories: [key],
      withdrawals: [Pair(Script(own), 0)],
    },
  )
}

test update_withdraws_non_zero_balance() {
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  withdraw(Transaction { ..tx, withdrawals: [Pair(Script(own), 5_000_000)] })
}

// Gate (rule 6).

test spend_with_gate() {
  let datum: Data = staking
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  run(tx, Spending { output: OutputReference(#"01", 0), datum: Some(datum) })
}

test spend_without_gate() fail {
  let datum: Data = staking
  let tx =
    update_tx(
      lock_input(deposit, 1_000, staking),
      lock_output(deposit, 1_000, staking),
    )
  run(
    Transaction { ..tx, withdrawals: [Pair(Script(owner_script), 0)] },
    Spending { output: OutputReference(#"01", 0), datum: Some(datum) },
  )
}

test mint_with_gate() {
  run(
    lock_tx(lock_output(deposit, 0, staking), assets.from_asset(own, "", 1)),
    Minting(own),
  )
}

test mint_without_gate() fail {
  let tx =
    lock_tx(lock_output(deposit, 0, staking), assets.from_asset(own, "", 1))
  run(Transaction { ..tx, withdrawals: [] }, Minting(own))
}

// Certificates (rule 8).

test publish_registration() {
  run(
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

test publish_deregistration() fail {
  run(
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

test publish_delegation() fail {
  run(
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

test vote_as_night_staking() fail {
  run(placeholder, Voting(DelegateRepresentative(Script(own))))
}

// Exact values: a UTxO padded with one junk token is refused wherever the contract reads it.

fn padded(output: Output) -> Output {
  Output { ..output, value: output.value |> assets.add(foreign, "", 1) }
}

test update_input_padded() fail {
  let input = lock_input(deposit, 1_000, staking)
  withdraw(
    update_tx(
      Input { ..input, output: padded(input.output) },
      lock_output(deposit, 1_000, staking),
    ),
  )
}

test unlock_input_padded() fail {
  let input = lock_input(deposit, 0, staking)
  withdraw(unlock_tx(Input { ..input, output: padded(input.output) }, t))
}

test update_output_padded() fail {
  withdraw(
    update_tx(
      lock_input(deposit, 1_000, staking),
      padded(lock_output(deposit, 1_000, staking)),
    ),
  )
}

test lock_reads_padded_pool_node() fail {
  let node = registered(pool, True)
  lock_reading([Input { ..node, output: padded(node.output) }])
}

test update_reads_padded_pool_node() fail {
  let node = registered(other_pool, True)
  re_points([Input { ..node, output: padded(node.output) }])
}

test unlock_pays_padded_return_output() fail {
  unlock_paying([padded(paid(returns, 1_500_000, 1_000))])
}

// Exact values, by the token's policy (lock_value): a spent lock must hold the token, and
// the token's and cNIGHT's policies sort either way.

fn spending(value: Value, cnight: Int) -> Bool {
  let input = lock_input(deposit, cnight, staking)
  withdraw(
    update_tx(
      Input { ..input, output: Output { ..input.output, value } },
      lock_output(deposit, cnight, staking),
    ),
  )
}

test update_spends_a_foreign_token_without_cnight() fail {
  spending(assets.from_lovelace(deposit) |> assets.add(foreign, "", 1), 0)
}

test update_spends_two_tokens_without_cnight() fail {
  spending(value(deposit, 2, 0), 0)
}

test update_spends_cnight_and_a_foreign_token_named_empty() fail {
  spending(
    assets.from_lovelace(deposit)
      |> assets.add(config.cnight_policy, config.cnight_name, 1_000)
      |> assets.add(foreign, "", 1),
    1_000,
  )
}

/// A script hash that sorts after cNIGHT's policy, so a lock's value lists cNIGHT first.
const late = #"e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5"

/// A lock at `late`'s address with its token and 1,000 cNIGHT.
const late_lock =
  Output {
    address: Address(Script(late), None),
    value: assets.from_lovelace(deposit)
      |> assets.add(late, "", 1)
      |> assets.add(config.cnight_policy, config.cnight_name, 1_000),
    datum: InlineDatum(staking),
    reference_script: None,
  }

/// `tx` with `late`'s withdrawal, as the ledger passes it to `late` for `action`.
fn withdraw_late(tx: Transaction, action: StakingAction) -> Bool {
  night_staking.night_staking.else(
    ScriptContext {
      transaction: Transaction {
        ..tx,
        withdrawals: [Pair(Script(late), 0)],
        redeemers: [Pair(Withdraw(Script(late)), as_data(action))],
      },
      redeemer: as_data(action),
      info: Withdrawing(Script(late)),
    },
  )
}

test lock_with_the_token_sorting_after_cnight() {
  withdraw_late(lock_tx(late_lock, assets.from_asset(late, "", 1)), Lock)
}

test update_with_the_token_sorting_after_cnight() {
  withdraw_late(
    update_tx(
      Input { output_reference: OutputReference(#"01", 0), output: late_lock },
      late_lock,
    ),
    Update,
  )
}

// Redeemer (user decision, 11-17): the redeemer names the action, and each action accepts
// one transaction shape. Every valid transaction below is refused under each other action.

fn as_action(tx: Transaction, action: StakingAction) -> Bool {
  withdraw(Transaction { ..tx, redeemers: acting(action) })
}

fn valid_lock() -> Transaction {
  lock_tx(lock_output(deposit, 1_000, staking), assets.from_asset(own, "", 1))
}

fn valid_update() -> Transaction {
  update_tx(
    lock_input(deposit, 1_000, staking),
    lock_output(deposit, 1_000, staking),
  )
}

fn valid_unbond() -> Transaction {
  unbond_tx(
    lock_input(deposit, 1_000, staking),
    lock_output(deposit, 1_000, unbonding),
  )
}

fn valid_unlock() -> Transaction {
  unlock_tx(lock_input(deposit, 1_000, unbonding), t + delay)
}

test valid_transactions_pass() {
  and {
    withdraw(valid_lock()),
    withdraw(valid_update()),
    withdraw(valid_unbond()),
    withdraw(valid_unlock()),
  }
}

test lock_as_update() fail {
  as_action(valid_lock(), Update)
}

test lock_as_unbond() fail {
  as_action(valid_lock(), Unbond)
}

test lock_as_unlock() fail {
  as_action(valid_lock(), Unlock)
}

test update_as_lock() fail {
  as_action(valid_update(), Lock)
}

test update_as_unbond() fail {
  as_action(valid_update(), Unbond)
}

test update_as_unlock() fail {
  as_action(valid_update(), Unlock)
}

test unbond_as_lock() fail {
  as_action(valid_unbond(), Lock)
}

test unbond_as_update() fail {
  as_action(valid_unbond(), Update)
}

test unbond_as_unlock() fail {
  as_action(valid_unbond(), Unlock)
}

test unlock_as_lock() fail {
  as_action(valid_unlock(), Lock)
}

test unlock_as_update() fail {
  as_action(valid_unlock(), Update)
}

test unlock_as_unbond() fail {
  as_action(valid_unlock(), Unbond)
}

// Shape and order (rule 7; user decision, 11-17): one output more at the address is
// refused, and the lock is the first output.

const change = paid(elsewhere, 5_000_000, 0)

test lock_makes_a_second_output_at_the_address() fail {
  let tx = valid_lock()
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        lock_output(deposit, 1_000, staking),
        Output { ..change, address: Address(Script(own), None) },
      ],
    },
  )
}

test update_makes_a_second_output_at_the_address() fail {
  let tx = valid_update()
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        lock_output(deposit, 1_000, staking),
        Output { ..change, address: Address(Script(own), None) },
      ],
    },
  )
}

test lock_with_change_after() {
  let tx = valid_lock()
  withdraw(
    Transaction {
      ..tx,
      outputs: [lock_output(deposit, 1_000, staking), change],
    },
  )
}

test lock_output_not_first() fail {
  let tx = valid_lock()
  withdraw(
    Transaction {
      ..tx,
      outputs: [change, lock_output(deposit, 1_000, staking)],
    },
  )
}

test update_output_not_first() fail {
  let tx = valid_update()
  withdraw(
    Transaction {
      ..tx,
      outputs: [change, lock_output(deposit, 1_000, staking)],
    },
  )
}

test unbond_output_not_first() fail {
  let tx = valid_unbond()
  withdraw(
    Transaction {
      ..tx,
      outputs: [change, lock_output(deposit, 1_000, unbonding)],
    },
  )
}

test lock_spends_a_lock() fail {
  let tx = valid_lock()
  withdraw(Transaction { ..tx, inputs: [lock_input(deposit, 1_000, staking)] })
}

test lock_output_at_another_address() fail {
  let tx = valid_lock()
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..lock_output(deposit, 1_000, staking),
          address: Address(VerificationKey(key), None),
        },
      ],
    },
  )
}

test update_mints_a_token() fail {
  let tx = valid_update()
  withdraw(Transaction { ..tx, mint: assets.from_asset(own, "", 1) })
}

test unbond_mints_a_token() fail {
  let tx = valid_unbond()
  withdraw(Transaction { ..tx, mint: assets.from_asset(own, "", 1) })
}

test unbond_output_at_another_address() fail {
  let tx = valid_unbond()
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        Output {
          ..lock_output(deposit, 1_000, unbonding),
          address: Address(VerificationKey(key), None),
        },
      ],
    },
  )
}

test unbond_makes_a_second_output_at_the_address() fail {
  let tx = valid_unbond()
  withdraw(
    Transaction {
      ..tx,
      outputs: [
        lock_output(deposit, 1_000, unbonding),
        Output { ..change, address: Address(Script(own), None) },
      ],
    },
  )
}

test unbond_an_unbonding_lock() fail {
  withdraw(
    unbond_tx(
      lock_input(deposit, 1_000, unbonding),
      lock_output(deposit, 1_000, unbonding),
    ),
  )
}

test unlock_pays_another_policy_under_the_cnight_name() fail {
  unlock_paying(
    [
      Output {
        ..paid(returns, 1_500_000, 0),
        value: assets.from_lovelace(1_500_000)
          |> assets.add(foreign, config.cnight_name, 1_000),
      },
    ],
  )
}

test lock_holds_another_policy_under_the_cnight_name() fail {
  let output = lock_output(deposit, 0, staking)
  withdraw(
    lock_tx(
      Output {
        ..output,
        value: output.value |> assets.add(foreign, config.cnight_name, 1_000),
      },
      assets.from_asset(own, "", 1),
    ),
  )
}

// Dust under cNIGHT's own policy: a second asset name is junk too.

test lock_holds_a_second_asset_of_the_cnight_policy() fail {
  let output = lock_output(deposit, 1_000, staking)
  withdraw(
    lock_tx(
      Output {
        ..output,
        value: output.value |> assets.add(config.cnight_policy, "junk", 1),
      },
      assets.from_asset(own, "", 1),
    ),
  )
}

test update_input_holds_a_second_asset_of_the_cnight_policy() fail {
  let input = lock_input(deposit, 1_000, staking)
  withdraw(
    update_tx(
      Input {
        ..input,
        output: Output {
          ..input.output,
          value: input.output.value
            |> assets.add(config.cnight_policy, "junk", 1),
        },
      },
      lock_output(deposit, 1_000, staking),
    ),
  )
}

test unlock_pays_a_second_asset_of_the_cnight_policy() fail {
  unlock_paying(
    [
      Output {
        ..paid(returns, 1_500_000, 1_000),
        value: paid(returns, 1_500_000, 1_000).value
          |> assets.add(config.cnight_policy, "junk", 1),
      },
    ],
  )
}

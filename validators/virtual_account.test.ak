use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{Value, add, from_asset, from_lovelace}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{Publishing, ScriptContext}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use config
use rewards/linked_list.{deposit_name, registration_name}
use rewards/test_fixtures.{
  account_address, account_policy, batcher_hash, ctx_mint, ctx_spend,
  ctx_withdraw, mk_deposit_output, mk_deposit_output_for, mk_head_output,
  mk_outref, mk_registration_output, mk_tail_output, withdrawal_of,
}
use rewards/types.{
  AccountAction, AccountDatum, ActionKind, Batcher, InitList, Register,
  SetDeregister, TopUp, UpdateRegistration, User, Withdraw, tail_key,
}
use virtual_account

const k1 = #"11111111111111111111111111111111111111111111111111111111"

const k2 = #"22222222222222222222222222222222222222222222222222222222"

const k3 = #"33333333333333333333333333333333333333333333333333333333"

const k4 = #"44444444444444444444444444444444444444444444444444444444"

const k5 = #"55555555555555555555555555555555555555555555555555555555"

const owner_key = #"99999999999999999999999999999999999999999999999999999999"

const owner = VerificationKey(owner_key)

const ada = 20_000_000

const refund = Address(VerificationKey(k5), None)

const own_withdrawal = withdrawal_of(account_policy)

const batcher_withdrawal = withdrawal_of(config.rewards_batcher_hash)

fn one_shot_input() -> Input {
  Input(
    OutputReference(
      config.virtual_account_one_shot_hash,
      config.virtual_account_one_shot_index,
    ),
    Output(refund, from_lovelace(5_000_000), NoDatum, None),
  )
}

fn nft(name: ByteArray, q: Int) -> Value {
  from_asset(account_policy, name, q)
}

fn run_at(tx: Transaction, kind: ActionKind, offset: Int) -> Bool {
  virtual_account.virtual_account.else(
    ctx_withdraw(tx, AccountAction { kind, offset }, account_policy),
  )
}

fn run(tx: Transaction, kind: ActionKind) -> Bool {
  run_at(tx, kind, 0)
}

fn run_gate_spend(tx: Transaction, gate: Data, input: Input) -> Bool {
  expect InlineDatum(d) = input.output.datum
  expect d: AccountDatum = d
  virtual_account.virtual_account.else(
    ctx_spend(tx, gate, input.output_reference, d),
  )
}

fn run_gate_mint(tx: Transaction, gate: Data) -> Bool {
  virtual_account.virtual_account.else(ctx_mint(tx, gate, account_policy))
}

fn registration(skh: ByteArray) -> Output {
  mk_registration_output(skh, owner, "", "", False)
}

/// User transaction skeleton: own withdrawal present.
fn user_tx(
  inputs: List<Input>,
  outputs: List<Output>,
  mint: Value,
  signers: List<ByteArray>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs,
    outputs,
    mint,
    extra_signatories: signers,
    withdrawals: [own_withdrawal],
  }
}

fn register_tx(
  anchor_in: Output,
  anchor_out: Output,
  node: Output,
  reg: Output,
  skh: ByteArray,
  signers: List<ByteArray>,
) -> Transaction {
  user_tx(
    [Input(mk_outref(1), anchor_in)],
    [anchor_out, node, reg],
    nft(deposit_name(skh), 1) |> add(account_policy, registration_name(skh), 1),
    signers,
  )
}

fn register(tx: Transaction) -> Bool {
  run(tx, Register)
}

// -- init ------------------------------------------------------------------

fn init_tx() -> Transaction {
  user_tx(
    [one_shot_input()],
    [mk_head_output(tail_key), mk_tail_output()],
    nft("", 1) |> add(account_policy, deposit_name(tail_key), 1),
    [],
  )
}

test init_ok() {
  run(init_tx(), InitList)
}

test init_without_one_shot() fail {
  run(Transaction { ..init_tx(), inputs: [] }, InitList)
}

test init_wrong_asset_name() fail {
  let tx =
    Transaction {
      ..init_tx(),
      mint: nft("x", 1) |> add(account_policy, deposit_name(tail_key), 1),
    }
  run(tx, InitList)
}

test init_head_points_elsewhere() fail {
  run(
    Transaction { ..init_tx(), outputs: [mk_head_output(k1), mk_tail_output()] },
    InitList,
  )
}

test init_with_list_input() fail {
  let tx =
    Transaction {
      ..init_tx(),
      inputs: [one_shot_input(), Input(mk_outref(2), mk_head_output(k1))],
    }
  run(tx, InitList)
}

// -- register --------------------------------------------------------------

test register_after_head() {
  let tx =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  register(tx)
}

test register_between_nodes() {
  let tx =
    register_tx(
      mk_deposit_output(k1, ada, 7, k3, None),
      mk_deposit_output(k1, ada, 7, k2, None),
      mk_deposit_output(k2, ada, 0, k3, None),
      registration(k2),
      k2,
      [k2],
    )
  register(tx)
}

test register_at_tail() {
  let tx =
    register_tx(
      mk_deposit_output(k1, ada, 0, tail_key, None),
      mk_deposit_output(k1, ada, 0, k2, None),
      mk_deposit_output(k2, ada, 0, tail_key, None),
      registration(k2),
      k2,
      [k2],
    )
  register(tx)
}

test register_key_below_anchor() fail {
  let tx =
    register_tx(
      mk_deposit_output(k2, ada, 0, tail_key, None),
      mk_deposit_output(k2, ada, 0, k1, None),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  register(tx)
}

test register_key_above_next() fail {
  let tx =
    register_tx(
      mk_deposit_output(k1, ada, 0, k2, None),
      mk_deposit_output(k1, ada, 0, k3, None),
      mk_deposit_output(k3, ada, 0, k2, None),
      registration(k3),
      k3,
      [k3],
    )
  register(tx)
}

test register_duplicate_of_anchor() fail {
  let tx =
    register_tx(
      mk_deposit_output(k1, ada, 0, tail_key, None),
      mk_deposit_output(k1, ada, 0, k1, None),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  register(tx)
}

test register_duplicate_of_next() fail {
  let tx =
    register_tx(
      mk_head_output(k1),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, k1, None),
      registration(k1),
      k1,
      [k1],
    )
  register(tx)
}

test register_two_anchors() fail {
  let base =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  let tx =
    Transaction {
      ..base,
      inputs: [
        Input(mk_outref(1), mk_head_output(tail_key)),
        Input(mk_outref(2), mk_deposit_output(k2, ada, 0, tail_key, None)),
      ],
    }
  register(tx)
}

test register_anchor_without_nft() fail {
  let junk =
    Output { ..mk_head_output(tail_key), value: from_lovelace(2_000_000) }
  let tx =
    register_tx(
      junk,
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  register(tx)
}

test register_missing_stake_sig() fail {
  let tx =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [],
    )
  register(tx)
}

test register_script_credential() {
  let cred = Script(k1)
  let base =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output_for(cred, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [],
    )
  let tx =
    Transaction { ..base, withdrawals: [own_withdrawal, withdrawal_of(k1)] }
  run(tx, Register)
}

test register_deposit_below_min() fail {
  let tx =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, config.deposit_min_lovelace - 1, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  register(tx)
}

test register_deposit_above_cap() fail {
  let tx =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, config.deposit_cap_lovelace + 1, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  register(tx)
}

test register_deposit_with_night() fail {
  let tx =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 1, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  register(tx)
}

test register_missing_registration_output() fail {
  let base =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  let tx =
    Transaction {
      ..base,
      outputs: [
        mk_head_output(k1),
        mk_deposit_output(k1, ada, 0, tail_key, None),
      ],
    }
  register(tx)
}

test register_registration_name_mismatch() fail {
  let tx =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k2),
      k1,
      [k1],
    )
  register(tx)
}

test register_dust_address_too_long() fail {
  let long = bytearray.concat(k1, #"000000000000")
  let tx =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      mk_registration_output(k1, owner, long, "", False),
      k1,
      [k1],
    )
  register(tx)
}

test register_wrong_mint_shape() fail {
  let base =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  register(Transaction { ..base, mint: nft(deposit_name(k1), 1) })
}

// -- withdraw / top up -------------------------------------------------------

fn deposit_input(night: Int) -> Input {
  Input(mk_outref(3), mk_deposit_output(k1, ada, night, k2, None))
}

fn spend_tx(input: Input, out: Output, signers: List<ByteArray>) -> Transaction {
  user_tx([input], [out], assets.zero, signers)
}

test withdraw_ok() {
  let input = deposit_input(500)
  run(spend_tx(input, mk_deposit_output(k1, ada, 0, k2, None), [k1]), Withdraw)
}

test withdraw_partial() fail {
  let input = deposit_input(500)
  run(spend_tx(input, mk_deposit_output(k1, ada, 1, k2, None), [k1]), Withdraw)
}

test withdraw_ada_changed() fail {
  let input = deposit_input(500)
  run(
    spend_tx(input, mk_deposit_output(k1, ada - 1, 0, k2, None), [k1]),
    Withdraw,
  )
}

test withdraw_datum_changed() fail {
  let input = deposit_input(500)
  run(spend_tx(input, mk_deposit_output(k1, ada, 0, k3, None), [k1]), Withdraw)
}

test withdraw_no_sig() fail {
  let input = deposit_input(500)
  run(spend_tx(input, mk_deposit_output(k1, ada, 0, k2, None), []), Withdraw)
}

test withdraw_moved_address() fail {
  let input = deposit_input(500)
  let out =
    Output { ..mk_deposit_output(k1, ada, 0, k2, None), address: refund }
  run(spend_tx(input, out, [k1]), Withdraw)
}

test withdraw_with_extra_deposit_input() fail {
  let input = deposit_input(500)
  let base = spend_tx(input, mk_deposit_output(k1, ada, 0, k2, None), [k1])
  let tx =
    Transaction {
      ..base,
      inputs: [
        input,
        Input(mk_outref(7), mk_deposit_output(k2, ada, 0, k3, None)),
      ],
    }
  run(tx, Withdraw)
}

test withdraw_with_mint() fail {
  let input = deposit_input(500)
  let base = spend_tx(input, mk_deposit_output(k1, ada, 0, k2, None), [k1])
  run(Transaction { ..base, mint: nft(deposit_name(k3), 1) }, Withdraw)
}

test withdraw_head_fails() fail {
  let input = Input(mk_outref(5), mk_head_output(k1))
  run(spend_tx(input, mk_head_output(k1), [k1]), Withdraw)
}

test withdraw_tail_fails() fail {
  let input = Input(mk_outref(6), mk_tail_output())
  run(spend_tx(input, mk_tail_output(), [k1]), Withdraw)
}

test top_up_ok() {
  let input = deposit_input(500)
  let tx =
    spend_tx(
      input,
      mk_deposit_output(k1, ada + config.deposit_min_lovelace, 500, k2, None),
      [k1],
    )
  run(tx, TopUp)
}

test top_up_below_min_increment() fail {
  let input = deposit_input(500)
  let tx =
    spend_tx(
      input,
      mk_deposit_output(
        k1,
        ada + config.deposit_min_lovelace - 1,
        500,
        k2,
        None,
      ),
      [k1],
    )
  run(tx, TopUp)
}

test top_up_above_cap() fail {
  let input = deposit_input(500)
  let tx =
    spend_tx(
      input,
      mk_deposit_output(k1, config.deposit_cap_lovelace + 1, 500, k2, None),
      [k1],
    )
  run(tx, TopUp)
}

test top_up_night_changed() fail {
  let input = deposit_input(500)
  let tx =
    spend_tx(
      input,
      mk_deposit_output(k1, ada + config.deposit_min_lovelace, 501, k2, None),
      [k1],
    )
  run(tx, TopUp)
}

// -- set deregister ----------------------------------------------------------

fn deregister_tx(
  deposit_in: Input,
  deposit_out: Output,
  registration_in: Input,
  burned: ByteArray,
  signers: List<ByteArray>,
) -> Transaction {
  user_tx(
    [deposit_in, registration_in],
    [deposit_out],
    nft(registration_name(burned), -1),
    signers,
  )
}

fn registration_input() -> Input {
  Input(mk_outref(4), registration(k1))
}

test set_deregister_ok() {
  let input = deposit_input(500)
  let tx =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(refund)),
      registration_input(),
      k1,
      [k1, owner_key],
    )
  run(tx, SetDeregister)
}

test set_deregister_inputs_swapped_ok() {
  let input = deposit_input(500)
  let base =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(refund)),
      registration_input(),
      k1,
      [k1, owner_key],
    )
  let tx = Transaction { ..base, inputs: [registration_input(), input] }
  run(tx, SetDeregister)
}

test set_deregister_already_set() fail {
  let input =
    Input(mk_outref(3), mk_deposit_output(k1, ada, 500, k2, Some(refund)))
  let tx =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(refund)),
      registration_input(),
      k1,
      [k1, owner_key],
    )
  run(tx, SetDeregister)
}

test set_deregister_no_stake_sig() fail {
  let input = deposit_input(500)
  let tx =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(refund)),
      registration_input(),
      k1,
      [owner_key],
    )
  run(tx, SetDeregister)
}

test set_deregister_no_owner_sig() fail {
  let input = deposit_input(500)
  let tx =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(refund)),
      registration_input(),
      k1,
      [k1],
    )
  run(tx, SetDeregister)
}

test set_deregister_value_changed() fail {
  let input = deposit_input(500)
  let tx =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 0, k2, Some(refund)),
      registration_input(),
      k1,
      [k1, owner_key],
    )
  run(tx, SetDeregister)
}

test set_deregister_without_burn() fail {
  let input = deposit_input(500)
  let base =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(refund)),
      registration_input(),
      k1,
      [k1, owner_key],
    )
  run(Transaction { ..base, mint: assets.zero }, SetDeregister)
}

test set_deregister_burns_other_registration() fail {
  let input = deposit_input(500)
  let tx =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(refund)),
      Input(mk_outref(4), registration(k2)),
      k2,
      [k1, owner_key],
    )
  run(tx, SetDeregister)
}

test set_deregister_any_refund_address_ok() {
  let input = deposit_input(500)
  let tx =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(account_address)),
      registration_input(),
      k1,
      [k1, owner_key],
    )
  run(tx, SetDeregister)
}

test set_deregister_flag_not_set() fail {
  let input = deposit_input(500)
  let tx =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, None),
      registration_input(),
      k1,
      [k1, owner_key],
    )
  run(tx, SetDeregister)
}

test set_deregister_two_accounts_ok() {
  let d1 = deposit_input(500)
  let d2 = Input(mk_outref(8), mk_deposit_output(k2, ada, 0, k3, None))
  let r2 = Input(mk_outref(9), registration(k2))
  let tx =
    user_tx(
      [d1, r2, registration_input(), d2],
      [
        mk_deposit_output(k1, ada, 500, k2, Some(refund)),
        mk_deposit_output(k2, ada, 0, k3, Some(refund)),
      ],
      nft(registration_name(k1), -1)
        |> add(account_policy, registration_name(k2), -1),
      [k1, k2, owner_key],
    )
  run(tx, SetDeregister)
}

// -- registration update -----------------------------------------------------

test registration_update_ok() {
  let input = registration_input()
  let tx =
    spend_tx(
      input,
      mk_registration_output(k1, owner, #"aabb", #"ccdd", True),
      [owner_key],
    )
  run(tx, UpdateRegistration)
}

test registration_owner_rotate_ok() {
  let input = registration_input()
  let tx =
    spend_tx(
      input,
      mk_registration_output(k1, VerificationKey(k5), "", "", False),
      [owner_key],
    )
  run(tx, UpdateRegistration)
}

test registration_update_dust_too_long() fail {
  let input = registration_input()
  let tx =
    spend_tx(
      input,
      mk_registration_output(
        k1,
        owner,
        bytearray.concat(k1, #"000000000000"),
        "",
        False,
      ),
      [owner_key],
    )
  run(tx, UpdateRegistration)
}

test registration_update_nft_dropped() fail {
  let input = registration_input()
  let out = Output { ..registration(k1), value: from_lovelace(2_000_000) }
  run(spend_tx(input, out, [owner_key]), UpdateRegistration)
}

test registration_update_wrong_signer() fail {
  let input = registration_input()
  run(spend_tx(input, registration(k1), [k1]), UpdateRegistration)
}

test registration_update_moved_address() fail {
  let input = registration_input()
  let out = Output { ..registration(k1), address: refund }
  run(spend_tx(input, out, [owner_key]), UpdateRegistration)
}

test registration_update_with_burn() fail {
  let input = registration_input()
  let base = spend_tx(input, registration(k1), [owner_key])
  run(
    Transaction { ..base, mint: nft(registration_name(k1), -1) },
    UpdateRegistration,
  )
}

test registration_update_on_deposit() fail {
  let input = deposit_input(0)
  run(
    spend_tx(input, mk_deposit_output(k1, ada, 0, k2, None), [k1]),
    UpdateRegistration,
  )
}

// -- offsets and multiple accounts ------------------------------------------

const foreign = Output(refund, from_lovelace(1_000_000), NoDatum, None)

test withdraw_at_offset_ok() {
  let input = deposit_input(500)
  let tx =
    user_tx(
      [input],
      [foreign, mk_deposit_output(k1, ada, 0, k2, None)],
      assets.zero,
      [k1],
    )
  run_at(tx, Withdraw, 1)
}

test withdraw_wrong_offset() fail {
  let input = deposit_input(500)
  let tx =
    user_tx(
      [input],
      [foreign, mk_deposit_output(k1, ada, 0, k2, None)],
      assets.zero,
      [k1],
    )
  run_at(tx, Withdraw, 0)
}

test init_at_offset_ok() {
  let tx =
    Transaction {
      ..init_tx(),
      outputs: [foreign, mk_head_output(tail_key), mk_tail_output()],
    }
  run_at(tx, InitList, 1)
}

fn two_deposits() -> (Input, Input) {
  (
    deposit_input(500),
    Input(mk_outref(8), mk_deposit_output(k2, ada, 7, k3, None)),
  )
}

test withdraw_two_accounts_ok() {
  let (d1, d2) = two_deposits()
  let tx =
    user_tx(
      [d1, d2],
      [
        mk_deposit_output(k1, ada, 0, k2, None),
        mk_deposit_output(k2, ada, 0, k3, None),
      ],
      assets.zero,
      [k1, k2],
    )
  run(tx, Withdraw)
}

test withdraw_two_accounts_outputs_swapped() fail {
  let (d1, d2) = two_deposits()
  let tx =
    user_tx(
      [d1, d2],
      [
        mk_deposit_output(k2, ada, 0, k3, None),
        mk_deposit_output(k1, ada, 0, k2, None),
      ],
      assets.zero,
      [k1, k2],
    )
  run(tx, Withdraw)
}

test withdraw_two_accounts_one_sig() fail {
  let (d1, d2) = two_deposits()
  let tx =
    user_tx(
      [d1, d2],
      [
        mk_deposit_output(k1, ada, 0, k2, None),
        mk_deposit_output(k2, ada, 0, k3, None),
      ],
      assets.zero,
      [k1],
    )
  run(tx, Withdraw)
}

test withdraw_two_accounts_one_output() fail {
  let (d1, d2) = two_deposits()
  let tx =
    user_tx(
      [d1, d2],
      [mk_deposit_output(k1, ada, 0, k2, None)],
      assets.zero,
      [k1, k2],
    )
  run(tx, Withdraw)
}

test top_up_two_accounts_ok() {
  let (d1, d2) = two_deposits()
  let tx =
    user_tx(
      [d1, d2],
      [
        mk_deposit_output(k1, ada + config.deposit_min_lovelace, 500, k2, None),
        mk_deposit_output(k2, ada + config.deposit_min_lovelace, 7, k3, None),
      ],
      assets.zero,
      [k1, k2],
    )
  run(tx, TopUp)
}

test update_two_registrations_ok() {
  let r1 = registration_input()
  let r2 = Input(mk_outref(9), registration(k2))
  let tx =
    user_tx(
      [r1, r2],
      [
        mk_registration_output(k1, owner, #"aa", "", True),
        mk_registration_output(k2, owner, #"bb", "", False),
      ],
      assets.zero,
      [owner_key],
    )
  run(tx, UpdateRegistration)
}

/// Two anchors: head (k1 goes first) and k2 (k3 goes after it).
fn register_two_tx(mint: Value) -> Transaction {
  user_tx(
    [
      Input(mk_outref(1), mk_head_output(k2)),
      Input(mk_outref(2), mk_deposit_output(k2, ada, 0, tail_key, None)),
    ],
    [
      foreign,
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, k2, None),
      registration(k1),
      mk_deposit_output(k2, ada, 0, k3, None),
      mk_deposit_output(k3, ada, 0, tail_key, None),
      registration(k3),
    ],
    mint,
    [k1, k3],
  )
}

fn mint_pair(skh: ByteArray) -> Value {
  nft(deposit_name(skh), 1) |> add(account_policy, registration_name(skh), 1)
}

test register_two_accounts_ok() {
  run_at(
    register_two_tx(mint_pair(k1) |> assets.merge(mint_pair(k3))),
    Register,
    1,
  )
}

test register_two_accounts_mint_for_one() fail {
  run_at(register_two_tx(mint_pair(k1)), Register, 1)
}

test register_two_accounts_extra_mint() fail {
  let mint =
    mint_pair(k1) |> assets.merge(mint_pair(k3)) |> assets.merge(mint_pair(k4))
  run_at(register_two_tx(mint), Register, 1)
}

test register_two_accounts_one_anchor() fail {
  // k2 and k3 both need the k1 node as anchor; one anchor links one key.
  let tx =
    user_tx(
      [Input(mk_outref(1), mk_deposit_output(k1, ada, 0, tail_key, None))],
      [
        mk_deposit_output(k1, ada, 0, k2, None),
        mk_deposit_output(k2, ada, 0, tail_key, None),
        registration(k2),
        mk_deposit_output(k3, ada, 0, tail_key, None),
        registration(k3),
      ],
      mint_pair(k2) |> assets.merge(mint_pair(k3)),
      [k2, k3],
    )
  run(tx, Register)
}

// -- gates -------------------------------------------------------------------

test spend_user_gate_ok() {
  let input = deposit_input(0)
  run_gate_spend(user_tx([input], [], assets.zero, []), User, input)
}

test spend_user_gate_without_own_withdrawal() fail {
  let input = deposit_input(0)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input],
      withdrawals: [batcher_withdrawal],
    }
  run_gate_spend(tx, User, input)
}

test spend_batcher_gate_ok() {
  let input = deposit_input(0)
  let head = Input(mk_outref(5), mk_head_output(k1))
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input, head],
      withdrawals: [batcher_withdrawal],
    }
  and {
    run_gate_spend(tx, Batcher, input),
    run_gate_spend(tx, Batcher, head),
  }
}

test spend_batcher_gate_without_batcher_withdrawal() fail {
  let input = deposit_input(0)
  let tx =
    Transaction {
      ..placeholder,
      inputs: [input],
      withdrawals: [own_withdrawal, withdrawal_of(batcher_hash)],
    }
  run_gate_spend(tx, Batcher, input)
}

test mint_user_gate_ok() {
  run_gate_mint(user_tx([], [], nft(deposit_name(k1), 1), []), User)
}

test mint_user_gate_without_own_withdrawal() fail {
  run_gate_mint(
    Transaction { ..placeholder, withdrawals: [batcher_withdrawal] },
    User,
  )
}

test mint_batcher_gate_ok() {
  run_gate_mint(
    Transaction { ..placeholder, withdrawals: [batcher_withdrawal] },
    Batcher,
  )
}

test publish_registration_ok() {
  let info =
    Publishing {
      at: 0,
      certificate: RegisterCredential {
        credential: Script(account_policy),
        deposit: Never,
      },
    }
  virtual_account.virtual_account.else(ScriptContext(placeholder, Void, info))
}

// -- mutual exclusion with the batcher ----------------------------------------
// No explicit check: the exact own-input set of every action rejects any tx
// that also carries batch inputs. Both withdrawals may coexist only when the
// input sets are disjoint.

fn with_batcher(tx: Transaction) -> Transaction {
  Transaction { ..tx, withdrawals: [own_withdrawal, batcher_withdrawal] }
}

test exclusion_withdraw_next_to_batch_deposit() fail {
  let input = deposit_input(500)
  let base = spend_tx(input, mk_deposit_output(k1, ada, 0, k2, None), [k1])
  let tx =
    Transaction {
      ..with_batcher(base),
      inputs: [
        input,
        Input(mk_outref(7), mk_deposit_output(k2, ada, 100, k3, None)),
      ],
    }
  run(tx, Withdraw)
}

test exclusion_register_next_to_batch_deposit() fail {
  let base =
    register_tx(
      mk_head_output(tail_key),
      mk_head_output(k1),
      mk_deposit_output(k1, ada, 0, tail_key, None),
      registration(k1),
      k1,
      [k1],
    )
  let tx =
    Transaction {
      ..with_batcher(base),
      inputs: [
        Input(mk_outref(1), mk_head_output(tail_key)),
        Input(mk_outref(7), mk_deposit_output(k2, ada, 100, k3, None)),
      ],
    }
  register(tx)
}

test exclusion_register_next_to_batch_exit_head() fail {
  // A batch exit spends the head as predecessor; a Register in the same tx
  // would then see two list inputs.
  let base =
    register_tx(
      mk_deposit_output(k2, ada, 0, tail_key, None),
      mk_deposit_output(k2, ada, 0, k3, None),
      mk_deposit_output(k3, ada, 0, tail_key, None),
      registration(k3),
      k3,
      [k3],
    )
  let tx =
    Transaction {
      ..with_batcher(base),
      inputs: [
        Input(mk_outref(1), mk_deposit_output(k2, ada, 0, tail_key, None)),
        Input(mk_outref(5), mk_head_output(k1)),
      ],
      mint: base.mint |> add(account_policy, deposit_name(k1), -1),
    }
  register(tx)
}

test exclusion_set_deregister_next_to_batch_deposit() fail {
  let input = deposit_input(500)
  let base =
    deregister_tx(
      input,
      mk_deposit_output(k1, ada, 500, k2, Some(refund)),
      registration_input(),
      k1,
      [k1, owner_key],
    )
  let tx =
    Transaction {
      ..with_batcher(base),
      inputs: [
        input,
        registration_input(),
        Input(mk_outref(7), mk_deposit_output(k2, ada, 100, k3, None)),
      ],
    }
  run(tx, SetDeregister)
}

test exclusion_withdraw_with_batch_burn() fail {
  let input = deposit_input(500)
  let base = spend_tx(input, mk_deposit_output(k1, ada, 0, k2, None), [k1])
  let tx = Transaction { ..with_batcher(base), mint: nft(deposit_name(k2), -1) }
  run(tx, Withdraw)
}

test coexistence_with_disjoint_inputs_ok() {
  let input = deposit_input(500)
  let tx =
    with_batcher(spend_tx(input, mk_deposit_output(k1, ada, 0, k2, None), [k1]))
  run(tx, Withdraw)
}

// -- ordering property -------------------------------------------------------

/// Insert every key through the validator; returns (head_next, nodes as (key, next)).
fn insert_all(
  keys: List<ByteArray>,
  head_next: ByteArray,
  nodes: List<(ByteArray, ByteArray)>,
) -> (ByteArray, List<(ByteArray, ByteArray)>) {
  when keys is {
    [] -> (head_next, nodes)
    [k, ..rest] -> {
      let (anchor_in, anchor_out, new_next, head_next2, nodes2) =
        if bytearray.compare(k, head_next) == Less {
          (
            mk_head_output(head_next),
            mk_head_output(k),
            head_next,
            k,
            [(k, head_next), ..nodes],
          )
        } else {
          expect Some((ak, an)) =
            list.find(
              nodes,
              fn(n) {
                bytearray.compare(n.1st, k) == Less && bytearray.compare(
                  k,
                  n.2nd,
                ) == Less
              },
            )
          (
            mk_deposit_output(ak, ada, 0, an, None),
            mk_deposit_output(ak, ada, 0, k, None),
            an,
            head_next,
            [
              (k, an),
              ..list.map(
                nodes,
                fn(n) {
                  if n.1st == ak {
                    (ak, k)
                  } else {
                    n
                  }
                },
              )
            ],
          )
        }
      let tx =
        register_tx(
          anchor_in,
          anchor_out,
          mk_deposit_output(k, ada, 0, new_next, None),
          registration(k),
          k,
          [k],
        )
      expect register(tx)
      insert_all(rest, head_next2, nodes2)
    }
  }
}

fn walk(
  cursor: ByteArray,
  nodes: List<(ByteArray, ByteArray)>,
  acc: List<ByteArray>,
) -> List<ByteArray> {
  if cursor == tail_key {
    list.reverse(acc)
  } else {
    expect Some((_, next)) = list.find(nodes, fn(n) { n.1st == cursor })
    walk(next, nodes, [cursor, ..acc])
  }
}

test inserts_in_any_order_yield_ascending_chain() {
  let (head_next, nodes) = insert_all([k3, k1, k5, k2, k4], tail_key, [])
  walk(head_next, nodes, []) == [k1, k2, k3, k4, k5]
}

//// Shared fixtures for the rewards test modules: fake script hashes and
//// builders for the UTXO shapes the validators inspect.

use aiken/primitive/bytearray
use bridge/types.{AuthoritySetCommitment, BeefyConsensusState} as bridge_types
use cardano/address.{Address, Credential, Script, VerificationKey}
use cardano/assets.{Value, add, from_lovelace}
use cardano/script_context.{Minting, ScriptContext, Spending, Withdrawing}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use rewards/types.{
  AccountDatum, BatcherState, Deposit, Head, Registration, Tail,
}

pub const account_policy =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

pub const batcher_hash =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

pub const pool_forever =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

pub const bridge_forever =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

pub const account_address = Address(Script(account_policy), None)

pub const batcher_address = Address(Script(batcher_hash), None)

pub const pool_address = Address(Script(pool_forever), None)

pub const bridge_address = Address(Script(bridge_forever), None)

pub fn deposit_name(skh: ByteArray) -> ByteArray {
  bytearray.concat(#"00", skh)
}

pub fn registration_name(skh: ByteArray) -> ByteArray {
  bytearray.concat(#"01", skh)
}

pub fn night(amount: Int) -> Value {
  assets.from_asset(config.cnight_policy, config.cnight_name, amount)
}

pub fn mk_head_output(next: ByteArray) -> Output {
  Output(
    account_address,
    from_lovelace(2_000_000) |> add(account_policy, "", 1),
    InlineDatum(Head { next }),
    None,
  )
}

pub fn mk_tail_output() -> Output {
  Output(
    account_address,
    from_lovelace(2_000_000)
      |> add(account_policy, deposit_name(types.tail_key), 1),
    InlineDatum(Tail),
    None,
  )
}

pub fn mk_deposit_output(
  skh: ByteArray,
  ada: Int,
  night_amount: Int,
  next: ByteArray,
  committed: Option<Address>,
) -> Output {
  mk_deposit_output_for(
    VerificationKey(skh),
    ada,
    night_amount,
    next,
    committed,
  )
}

pub fn mk_deposit_output_for(
  cred: Credential,
  ada: Int,
  night_amount: Int,
  next: ByteArray,
  committed: Option<Address>,
) -> Output {
  let skh =
    when cred is {
      VerificationKey(h) -> h
      Script(h) -> h
    }
  Output(
    account_address,
    from_lovelace(ada)
      |> add(account_policy, deposit_name(skh), 1)
      |> add(config.cnight_policy, config.cnight_name, night_amount),
    InlineDatum(Deposit { cred, next, committed }),
    None,
  )
}

pub fn mk_registration_output(
  skh: ByteArray,
  owner: Credential,
  dust_address: ByteArray,
  validator_keys: ByteArray,
  spo_intent: Bool,
) -> Output {
  Output(
    account_address,
    from_lovelace(2_000_000) |> add(account_policy, registration_name(skh), 1),
    InlineDatum(
      Registration { owner, dust_address, validator_keys, spo_intent },
    ),
    None,
  )
}

pub fn mk_state_output(state: BatcherState) -> Output {
  Output(
    batcher_address,
    from_lovelace(2_000_000) |> add(batcher_hash, "", 1),
    InlineDatum(state),
    None,
  )
}

pub fn mk_pool_output(ada: Int, night_amount: Int) -> Output {
  Output(
    pool_address,
    from_lovelace(ada)
      |> add(config.cnight_policy, config.cnight_name, night_amount),
    InlineDatum(Void),
    None,
  )
}

pub fn mk_outref(tag: Int) -> OutputReference {
  OutputReference(
    #"9999999999999999999999999999999999999999999999999999999999999999",
    tag,
  )
}

pub fn mk_input(outref: OutputReference, output: Output) -> Input {
  Input(outref, output)
}

pub fn withdrawal_of(hash: ByteArray) -> Pair<Credential, Int> {
  Pair(Script(hash), 0)
}

pub fn ref_input_bridge(root: ByteArray) -> Input {
  let committee =
    AuthoritySetCommitment { id: 0, len: 0, keyset_commitment: "" }
  let state =
    BeefyConsensusState {
      latest_mmr_root: root,
      latest_height: 0,
      beefy_activation_block: 0,
      current_committee: committee,
      next_committee: committee,
    }
  Input(
    mk_outref(0),
    Output(
      bridge_address,
      from_lovelace(2_000_000) |> add(bridge_forever, "", 1),
      InlineDatum(state),
      None,
    ),
  )
}

pub fn ctx_mint(
  tx: Transaction,
  redeemer: Data,
  policy: ByteArray,
) -> ScriptContext {
  ScriptContext(tx, redeemer, Minting(policy))
}

pub fn ctx_spend(
  tx: Transaction,
  redeemer: Data,
  outref: OutputReference,
  datum: AccountDatum,
) -> ScriptContext {
  let d: Data = datum
  ScriptContext(tx, redeemer, Spending(outref, Some(d)))
}

pub fn ctx_withdraw(
  tx: Transaction,
  redeemer: Data,
  hash: ByteArray,
) -> ScriptContext {
  ScriptContext(tx, redeemer, Withdrawing(Script(hash)))
}

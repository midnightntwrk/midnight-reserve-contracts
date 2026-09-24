use aiken/builtin
use aiken/collection/list
use bridge/types.{BeefyThreshold} as bt
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{Value, add, from_asset, from_lovelace}
use cardano/script_context.{Minting, ScriptContext, Spending}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction, placeholder,
}
use config
use forever/types.{Versioned} as ft
use multisig/script.{build_native_script, create_signer}
use multisig/types.{Multisig, MultisigThreshold} as mt
use thresholds

const policy = #"00000000000000000000000000000000000000000000000000000002"

const script_address = Address(Script(policy), None)

const wallet =
  Address(
    VerificationKey(#"11111111111111111111111111111111111111111111111111111111"),
    None,
  )

const one_shot_ref =
  OutputReference(
    config.committee_threshold_one_shot_hash,
    config.committee_threshold_one_shot_index,
  )

fn threshold_output(datum: BeefyThreshold) -> Output {
  Output(
    script_address,
    from_lovelace(2_000_000) |> add(policy, "", 1),
    InlineDatum(datum),
    None,
  )
}

fn mint(datum: BeefyThreshold) -> Bool {
  let tx =
    Transaction {
      ..placeholder,
      mint: from_asset(policy, "", 1),
      inputs: [
        Input(
          one_shot_ref,
          Output(wallet, from_lovelace(5_000_000), InlineDatum(0), None),
        ),
      ],
      outputs: [threshold_output(datum)],
    }
  thresholds.beefy_signer_threshold.else(ScriptContext(tx, 0, Minting(policy)))
}

test mint_valid() {
  mint(BeefyThreshold(2, 3, 500_000, 20_000))
}

test mint_zero_cap() {
  mint(BeefyThreshold(2, 3, 0, 0))
}

test mint_rejects_negative_base() {
  !mint(BeefyThreshold(2, 3, -1, 20_000))
}

test mint_rejects_negative_per_signer() {
  !mint(BeefyThreshold(2, 3, 500_000, -1))
}

test mint_rejects_numerator_equal_denominator() {
  !mint(BeefyThreshold(3, 3, 0, 0))
}

test mint_rejects_negative_numerator() {
  !mint(BeefyThreshold(-1, 3, 0, 0))
}

// Spend under Council + Tech Auth: each multisig is one signer at 1/1, and
// the transaction mints under the native script rebuilt from each datum.

fn multisig_of(pkh: ByteArray) -> Multisig {
  Multisig { total_signers: 1, signers: [Pair(create_signer(pkh), #"")] }
}

const tech_auth =
  multisig_of(#"22222222222222222222222222222222222222222222222222222222")

const council =
  multisig_of(#"33333333333333333333333333333333333333333333333333333333")

fn native_policy(ms: Multisig) -> ByteArray {
  build_native_script(ms, 1, 1) |> builtin.blake2b_224
}

fn gov_ref(hash: ByteArray, tag: Int, ms: Multisig) -> Input {
  Input(
    OutputReference(
      #"8888888888888888888888888888888888888888888888888888888888888888",
      tag,
    ),
    Output(
      Address(Script(hash), None),
      from_lovelace(2_000_000) |> add(hash, "", 1),
      InlineDatum(Versioned { data: ms, logic_round: 0 }),
      None,
    ),
  )
}

const gov_refs =
  [
    gov_ref(config.technical_authority_forever_hash, 0, tech_auth),
    gov_ref(config.council_forever_hash, 1, council),
  ]

const gov_threshold_ref =
  Input(
    OutputReference(
      #"8888888888888888888888888888888888888888888888888888888888888888",
      2,
    ),
    Output(
      Address(Script(config.main_gov_threshold_hash), None),
      from_lovelace(2_000_000) |> add(config.main_gov_threshold_hash, "", 1),
      InlineDatum(MultisigThreshold(1, 1, 1, 1)),
      None,
    ),
  )

const own_ref =
  OutputReference(
    #"9999999999999999999999999999999999999999999999999999999999999999",
    0,
  )

fn spend_with(mint: Value, new_datum: BeefyThreshold) -> Bool {
  let old = BeefyThreshold(2, 3, 500_000, 20_000)
  let tx =
    Transaction {
      ..placeholder,
      mint,
      inputs: [Input(own_ref, threshold_output(old))],
      reference_inputs: list.concat(gov_refs, [gov_threshold_ref]),
      outputs: [threshold_output(new_datum)],
    }
  let old: Data = old
  thresholds.beefy_signer_threshold.else(
    ScriptContext(tx, 0, Spending(own_ref, Some(old))),
  )
}

const both_mints =
  from_asset(native_policy(tech_auth), "", 1)
    |> add(native_policy(council), "", 1)

fn spend(new_datum: BeefyThreshold) -> Bool {
  spend_with(both_mints, new_datum)
}

test spend_raises_cap() {
  spend(BeefyThreshold(2, 3, 1_000_000, 50_000))
}

test spend_changes_ratio() {
  spend(BeefyThreshold(3, 4, 500_000, 20_000))
}

test spend_rejects_negative_cap() {
  !spend(BeefyThreshold(2, 3, -1, 20_000))
}

test spend_rejects_bad_ratio() {
  !spend(BeefyThreshold(4, 3, 500_000, 20_000))
}

test spend_rejects_missing_council() fail {
  spend_with(
    from_asset(native_policy(tech_auth), "", 1),
    BeefyThreshold(2, 3, 1_000_000, 50_000),
  )
}

test spend_rejects_missing_tech_auth() fail {
  spend_with(
    from_asset(native_policy(council), "", 1),
    BeefyThreshold(2, 3, 1_000_000, 50_000),
  )
}

test spend_rejects_no_gov_mint() fail {
  spend_with(assets.zero, BeefyThreshold(2, 3, 1_000_000, 50_000))
}

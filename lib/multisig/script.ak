use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{Script}
use cardano/assets.{PolicyId, Value, to_dict}
use cardano/script_context.{Minting, ScriptInfo, Spending}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use forever/types.{Versioned} as t
use multisig/types.{
  Multisig, MultisigThreshold, NativeScript, NativeScriptSigner, Sr25519PubKey,
}
use utils.{
  get_input_state_by_policy, input_linked_mint, is_singleton, must_find,
}

const empty_list_length_byte = #"80" |> builtin.bytearray_to_integer(True, _)

const list_length_next_byte = #"98" |> builtin.bytearray_to_integer(True, _)

const list_length_next_2_byte = #"99"

const n_of_m_script_bytes = #"008303"

pub fn build_native_script(
  multisig: Multisig,
  threshold_numerator,
  threshold_denominator,
) -> NativeScript {
  let Multisig { total_signers, signers } = multisig

  // ceil always
  let min_signers =
    ( total_signers * threshold_numerator + ( threshold_denominator - 1 ) ) / threshold_denominator

  let min_signer_serialized = builtin.serialise_data(min_signers)

  let list_bytes = native_script_signer_list(signers |> builtin.un_map_data)

  let serialized_list =
    if total_signers <= 23 {
      builtin.cons_bytearray(empty_list_length_byte + total_signers, list_bytes)
    } else if total_signers <= 255 {
      builtin.cons_bytearray(
        list_length_next_byte,
        builtin.cons_bytearray(total_signers, list_bytes),
      )
    } else {
      builtin.serialise_data(total_signers)
        // Taking advantage of right side extension to modify 19 to become 99
        |> builtin.or_bytearray(True, _, list_length_next_2_byte)
        |> bytearray.concat(list_bytes)
    }

  bytearray.concat(n_of_m_script_bytes, min_signer_serialized)
    |> bytearray.concat(serialized_list)
}

fn native_script_signer_list(
  signers: Pairs<Data<NativeScriptSigner>, Data<Sr25519PubKey>>,
) -> ByteArray {
  when signers is {
    [] -> #""
    [x] -> x.1st |> builtin.un_b_data
    [x, y] ->
      x.1st |> builtin.un_b_data |> bytearray.concat(builtin.un_b_data(y.1st))
    [x, y, z, ..rest] ->
      x.1st
        |> builtin.un_b_data
        |> bytearray.concat(builtin.un_b_data(y.1st))
        |> bytearray.concat(builtin.un_b_data(z.1st))
        |> bytearray.concat(native_script_signer_list(rest))
  }
}

pub fn create_signer(pkh: VerificationKeyHash) -> ByteArray {
  expect builtin.length_of_bytearray(pkh) == 28

  bytearray.concat(#"8200581c", pkh)
}

pub fn check_for_multisig(
  inputs: List<Input>,
  mint: Value,
  nft_id: PolicyId,
  threshold_numerator,
  threshold_denominator,
) -> Bool {
  let input =
    must_find(
      inputs,
      fn(input) {
        when input.output.value |> to_dict |> to_pairs is {
          // (CM-1) Identify an input holding the forever NFT under `nft_id`.
          [_, Pair(nft_policy, _), ..] -> nft_policy == nft_id
          _ -> False
        }
      },
    )

  // (CM-2) Require the NFT input to expose an inline datum.
  expect InlineDatum(datum) = input.output.datum

  // (CM-3) Decode the datum into a versioned multisig configuration.
  expect Versioned { data: multisig, .. }: Versioned<Multisig> = datum

  let minting_policy =
    build_native_script(multisig, threshold_numerator, threshold_denominator)
      |> builtin.blake2b_224

  // (CM-4) Demand the transaction mint an asset under the rebuilt native script.
  list.any(mint |> to_dict |> to_pairs, fn(pair) { pair.1st == minting_policy })
}

pub fn threshold_validation(
  transaction: Transaction,
  info: ScriptInfo,
  one_shot_ref: OutputReference,
  datum_validation: fn(Data) -> Bool,
) {
  let Transaction { inputs, reference_inputs, outputs, mint, .. } = transaction

  when info is {
    Minting(own_policy) -> {
      // (THM-1) Capture the minted inline datum while validating the one-shot spend.
      let datum =
        input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

      and {
        // (THM-3) Touch `cnight_policy` so this helper remains in the script hash.
        own_policy != config.cnight_policy,
        // (THM-2) Require the inline datum to satisfy validator-specific checks.
        datum_validation(datum),
      }
    }

    Spending { output, .. } -> {
      // (THS-1) Locate the script input chosen by the ledger.
      let own_input =
        must_find(inputs, fn(input: Input) { input.output_reference == output })

      let Input { output: Output { address, value, .. }, .. } = own_input

      // (THS-2) Ensure the consumed input is locked by this script.
      expect Script(own_hash) as pay_cred = address.payment_credential

      // (THS-5) Require the input to hold exactly one NFT under the policy.
      expect is_singleton(value, own_hash, "")

      // (THS-16) Require the main governance threshold reference input to provide an inline datum.
      expect InlineDatum(ref_datum) =
        get_input_state_by_policy(
          reference_inputs,
          config.main_gov_threshold_hash,
        )

      // (THS-7) Decode the reference datum into a multisig threshold record.
      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      }: MultisigThreshold = ref_datum

      expect and {
          // (THS-8) Require the technical-authority native script rebuilt from the datum to appear in mint.
          check_for_multisig(
            reference_inputs,
            mint,
            config.technical_authority_forever_hash,
            technical_auth_numerator,
            technical_auth_denominator,
          ),
          // (THS-9) Require the council native script rebuilt from the datum to appear in mint.
          check_for_multisig(
            reference_inputs,
            mint,
            config.council_forever_hash,
            council_numerator,
            council_denominator,
          ),
        }

      // (THS-10) Inspect the first output for the replacement state.
      expect [
        Output { address: out_addr, value: out_value, datum: out_datum, .. },
        ..
      ] = outputs

      // (THS-12) Ensure the replacement datum is inline.
      expect InlineDatum(out_datum) = out_datum

      and {
        // (THS-13) Preserve the payment credential.
        out_addr.payment_credential == pay_cred,
        // (THS-14) Preserve the singleton NFT identity.
        is_singleton(out_value, own_hash, ""),
        // (THS-15) Validate the candidate datum using the supplied hook.
        datum_validation(out_datum),
      }
    }

    _ -> fail
  }
}

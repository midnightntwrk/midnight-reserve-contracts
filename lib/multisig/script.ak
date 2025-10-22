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
use multisig/types.{
  Multisig, MultisigThreshold, NativeScript, NativeScriptSigner, Sr25519PubKey,
}
use utils.{get_input_state_by_policy, input_linked_mint, must_find}

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

pub fn create_signer(pkh: Data<VerificationKeyHash>) -> ByteArray {
  let pkh = pkh |> builtin.un_b_data

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
          [_, Pair(nft_policy, _), ..] -> nft_policy == nft_id
          _ -> False
        }
      },
    )

  expect InlineDatum(datum) = input.output.datum

  expect multisig: Multisig = datum

  let minting_policy =
    build_native_script(multisig, threshold_numerator, threshold_denominator)
      |> builtin.blake2b_224

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
      let datum =
        input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)

      and {
        own_policy != config.cnight_policy,
        datum_validation(datum),
      }
    }

    Spending { output, .. } -> {
      let own_input =
        must_find(inputs, fn(input: Input) { input.output_reference == output })

      let Input { output: Output { address, value, .. }, .. } = own_input

      expect Script(own_hash) as pay_cred = address.payment_credential

      let expected_nft_id = [Pair(own_hash, [Pair("", 1)])]

      expect [_, ..nft_id] = value |> to_dict |> to_pairs

      expect as_data(expected_nft_id) == as_data(nft_id)

      expect InlineDatum(ref_datum) =
        get_input_state_by_policy(
          reference_inputs,
          config.main_gov_threshold_hash,
        )

      expect MultisigThreshold {
        technical_auth_numerator,
        technical_auth_denominator,
        council_numerator,
        council_denominator,
      }: MultisigThreshold = ref_datum

      expect and {
          check_for_multisig(
            reference_inputs,
            mint,
            config.technical_authority_forever_hash,
            technical_auth_numerator,
            technical_auth_denominator,
          ),
          check_for_multisig(
            reference_inputs,
            mint,
            config.council_forever_hash,
            council_numerator,
            council_denominator,
          ),
        }

      expect [
        Output { address: out_addr, value: out_value, datum: out_datum, .. },
        ..
      ] = outputs

      expect [_, ..out_nft_id] = out_value |> to_dict |> to_pairs

      expect InlineDatum(out_datum) = out_datum

      and {
        out_addr.payment_credential == pay_cred,
        nft_id == out_nft_id,
        datum_validation(out_datum),
      }
    }

    _ -> fail
  }
}

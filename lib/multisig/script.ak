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

/// Builds a native N-of-M multisig script from a Multisig datum and threshold.
/// The minimum signers is computed as ceiling(total * numerator / denominator).
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

/// Creates a native script signer entry from a verification key hash.
/// Prepends the native script header bytes to form a valid signer.
pub fn create_signer(pkh: VerificationKeyHash) -> ByteArray {
  expect builtin.length_of_bytearray(pkh) == 28

  bytearray.concat(#"8200581c", pkh)
}

/// Verifies multisig approval by checking that a native script derived from
/// the multisig datum and threshold was used to mint an asset in this transaction.
pub fn check_for_multisig(
  inputs: List<Input>,
  mint: Value,
  nft_id: PolicyId,
  threshold_numerator,
  threshold_denominator,
) -> Bool {
  // Find input holding the forever NFT under nft_id
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

  expect Versioned { data: multisig, .. }: Versioned<Multisig> = datum

  let minting_policy =
    build_native_script(multisig, threshold_numerator, threshold_denominator)
      |> builtin.blake2b_224

  // Transaction must mint under the rebuilt native script policy
  list.any(mint |> to_dict |> to_pairs, fn(pair) { pair.1st == minting_policy })
}

/// Shared threshold validator logic for both minting and spending.
/// On minting: validates one-shot spend and datum structure.
/// On spending: requires tech auth and council multisig approval, validates datum update.
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
        // Touch cnight_policy so it contributes to the script hash
        own_policy != config.cnight_policy,
        datum_validation(datum),
      }
    }

    Spending { output, .. } -> {
      let own_input =
        must_find(inputs, fn(input: Input) { input.output_reference == output })

      let Input { output: Output { address, value, .. }, .. } = own_input

      expect Script(own_hash) as pay_cred = address.payment_credential

      expect is_singleton(value, own_hash, "")

      let ref_datum =
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

      // Both tech auth and council must approve via native script minting
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

      expect InlineDatum(out_datum) = out_datum

      and {
        out_addr.payment_credential == pay_cred,
        is_singleton(out_value, own_hash, ""),
        datum_validation(out_datum),
      }
    }

    _ -> fail
  }
}

use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/assets.{PolicyId, Value, to_dict}
use cardano/transaction.{InlineDatum, Input}
use multisig/types.{Multisig, NativeScript, NativeScriptSigner}
use utils.{must_find}

const empty_list_length_byte = #"80" |> builtin.bytearray_to_integer(True, _)

const list_length_next_byte = #"98" |> builtin.bytearray_to_integer(True, _)

const list_length_next_2_byte = #"99"

const n_of_m_script_bytes = #"008303"

pub fn build_native_script(multisig: Multisig) -> NativeScript {
  let Multisig { total_signers, min_signers, signers } = multisig

  let min_signer_serialized = builtin.serialise_data(min_signers)

  let list_bytes = native_script_signer_list(signers |> builtin.un_list_data)

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
  signers: List<Data<NativeScriptSigner>>,
) -> ByteArray {
  when signers is {
    [] -> #""
    [x] -> builtin.un_b_data(x)
    [x, y] -> x |> builtin.un_b_data |> bytearray.concat(builtin.un_b_data(y))
    [x, y, z, ..rest] ->
      x
        |> builtin.un_b_data
        |> bytearray.concat(builtin.un_b_data(y))
        |> bytearray.concat(builtin.un_b_data(z))
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

  let minting_policy = build_native_script(multisig) |> builtin.blake2b_224

  list.any(mint |> to_dict |> to_pairs, fn(pair) { pair.1st == minting_policy })
}

pub fn update_thresholds() {
  todo
}

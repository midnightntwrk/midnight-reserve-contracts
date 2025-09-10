use aiken/builtin
use aiken/primitive/bytearray
use multisig/types.{Multisig, NativeScript, NativeScriptSigner}

const empty_list_length_byte = #"80" |> builtin.bytearray_to_integer(True, _)

const list_length_next_byte = #"98" |> builtin.bytearray_to_integer(True, _)

const list_length_next_2_byte = #"99"

const n_of_m_script_bytes = #"8303"

pub fn build_native_script(multisig: Multisig) -> NativeScript {
  let Multisig { total_signers, min_signers, signers } = multisig

  let min_signer_serialized = builtin.serialise_data(min_signers)

  let list_bytes = native_script_signer_list(signers |> builtin.un_list_data)
  let bytes_length = builtin.length_of_bytearray(list_bytes)
  let list_items = builtin.slice_bytearray(1, bytes_length, list_bytes)

  let serialized_list =
    if total_signers <= 23 {
      builtin.cons_bytearray(empty_list_length_byte + total_signers, list_items)
    } else if total_signers <= 255 {
      builtin.cons_bytearray(
        list_length_next_byte,
        builtin.cons_bytearray(total_signers, list_items),
      )
    } else {
      builtin.serialise_data(total_signers)
        |> builtin.or_bytearray(True, _, list_length_next_2_byte)
        |> bytearray.concat(list_items)
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

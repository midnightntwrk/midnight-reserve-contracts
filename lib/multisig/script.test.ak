use aiken/builtin
use multisig/script.{build_native_script, create_signer}
use multisig/types.{Multisig}

test number_serialize() {
  trace builtin.serialise_data(1)
  trace builtin.serialise_data(0)
  trace builtin.serialise_data(1000)
  trace builtin.serialise_data(1000000)

  // trace builtin.serialise_data(
  //   [
  //     #"0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
  //     #"0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
  //     #"0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
  //     #"0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
  //     #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
  //     #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
  //     #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
  //     #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
  //   ],
  // )
  Void
}

test native_script_creation() {
  let signer = #"5999dcd91e41b3e4c2ba037ea3b03db88e3ba566595161e7d73e857a"
  let signer2 = #"ccc4a58ebc9aa058cd0dee6f84e4de39e23574a054e405b0ca467a88"

  let multisig =
    Multisig {
      total_signers: 2,
      signers: [signer |> create_signer, signer2 |> create_signer],
      sr25519: [],
    }

  let native_script = build_native_script(multisig, 99, 100)

  let hash = builtin.blake2b_224(native_script)

  hash == #"b58c3545ac40fb8d90b14b7d3bfaac814420ff59b874b5ea840e886e"
}

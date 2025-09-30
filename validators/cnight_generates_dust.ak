use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use cardano/address.{Credential, Script, VerificationKey}
use cardano/assets.{quantity_of, to_dict}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, Spending, Withdrawing,
}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}
use utils.{must_find, one_shot_mint}

pub type DustMappingDatum {
  // Address of wallet's staking key to register for Dust production
  c_wallet: Credential,
  // DUST address on Midnight to accumulate produced DUST
  dust_address: ByteArray,
}

pub type DustAction {
  Create
  Burn
}

validator cnight_generates_dust {
  else(ctx: ScriptContext) {
    let ScriptContext { redeemer, info, transaction } = ctx

    let Transaction {
      inputs,
      outputs,
      mint,
      extra_signatories,
      withdrawals,
      ..
    } = transaction

    when info is {
      Minting(own_policy) ->
        if redeemer == as_data(Create) {
          expect [input, ..] = inputs

          let output_datum =
            one_shot_mint(
              inputs,
              mint,
              outputs,
              own_policy,
              input.output_reference,
            )

          expect DustMappingDatum { c_wallet, dust_address } = output_datum

          // TODO: How long is Midnight Address?
          expect builtin.length_of_bytearray(dust_address) > 0

          when c_wallet is {
            VerificationKey(key) -> list.has(extra_signatories, key)

            Script(_) as script ->
              list.any(withdrawals, fn(withdraw) { withdraw.1st == script })
          }
        } else {
          let pay_cred = Script(own_policy)

          let spent_inputs =
            list.foldl(
              inputs,
              0,
              fn(input, acc) {
                if input.output.address.payment_credential == pay_cred {
                  acc - 1
                } else {
                  acc
                }
              },
            )

          let Pair(_, tokens) =
            mint
              |> to_dict
              |> to_pairs
              |> must_find(fn(value) { value.1st == own_policy })

          [Pair("", spent_inputs)] == to_pairs(tokens)
        }

      Withdrawing(own_cred) -> {
        expect Script(own_hash) = own_cred
        let expected_nft = as_data([Pair(own_hash, [Pair("", 1)])])
        expect _ =
          list.foldl(
            inputs,
            outputs,
            fn(input, outputs) {
              if input.output.address.payment_credential == own_cred {
                expect [Output { value, datum, .. }, ..rest] = outputs

                expect [_, ..nft_id] = value |> to_dict |> to_pairs

                expect as_data(nft_id) == expected_nft

                expect InlineDatum(output_datum) = datum

                expect DustMappingDatum { c_wallet, dust_address } =
                  output_datum

                // TODO: How long is Midnight Address?
                expect builtin.length_of_bytearray(dust_address) > 0

                expect
                  when c_wallet is {
                    VerificationKey(key) -> list.has(extra_signatories, key)

                    Script(_) as script ->
                      list.any(
                        withdrawals,
                        fn(withdraw) { withdraw.1st == script },
                      )
                  }

                rest
              } else {
                outputs
              }
            },
          )

        True
      }

      Spending { datum, output } -> {
        expect Some(datum) = datum
        expect DustMappingDatum { c_wallet, .. } = datum

        expect Script(own_hash) as script =
          must_find(inputs, fn(input) { input.output_reference == output }).output.address.payment_credential

        let minted_quantity = quantity_of(mint, own_hash, "")
        and {
          when c_wallet is {
            VerificationKey(key) -> list.has(extra_signatories, key)

            Script(_) as script ->
              list.any(withdrawals, fn(withdraw) { withdraw.1st == script })
          },
          or {
            minted_quantity < 0,
            and {
              list.any(withdrawals, fn(withdraw) { withdraw.1st == script }),
              minted_quantity == 0,
            },
          },
        }
      }

      Publishing { certificate: RegisterCredential { .. }, .. } -> True

      _ -> fail
    }
  }
}

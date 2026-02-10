use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Credential, Script, VerificationKey}
use cardano/assets.{quantity_of, to_dict}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, Spending, Withdrawing,
}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}
use config
use utils.{input_linked_mint, must_find}

/// Links a Cardano wallet credential to a Midnight dust address.
pub type DustMappingDatum {
  c_wallet: Credential,
  dust_address: ByteArray,
}

pub type DustAction {
  Create
  Burn
}

/// Validates wallet authorization: verification keys must sign, scripts must appear in withdrawals.
fn check_auth(
  c_wallet: Credential,
  extra_signatories: List<VerificationKeyHash>,
  withdrawals: Pairs<Credential, Int>,
) {
  when c_wallet is {
    VerificationKey(key) -> list.has(extra_signatories, key)

    Script(_) as script ->
      list.any(withdrawals, fn(withdraw) { withdraw.1st == script })
  }
}

/// Manages dust mapping NFTs linking Cardano wallets to Midnight addresses.
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
            input_linked_mint(
              inputs,
              mint,
              outputs,
              own_policy,
              input.output_reference,
            )

          expect DustMappingDatum { c_wallet, dust_address } = output_datum

          expect builtin.length_of_bytearray(dust_address) <= 33

          check_auth(c_wallet, extra_signatories, withdrawals)
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
          and {
            [Pair("", spent_inputs)] == to_pairs(tokens),
            own_policy != config.cnight_policy,
          }
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
                expect [Output { address, value, datum, .. }, ..rest] = outputs

                expect address.payment_credential == own_cred

                expect [_, ..nft_id] = value |> to_dict |> to_pairs

                expect as_data(nft_id) == expected_nft

                expect InlineDatum(output_datum) = datum

                expect DustMappingDatum { c_wallet, dust_address } =
                  output_datum

                expect builtin.length_of_bytearray(dust_address) <= 33

                expect check_auth(c_wallet, extra_signatories, withdrawals)

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
          check_auth(c_wallet, extra_signatories, withdrawals),
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

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
use config
use utils.{input_linked_mint, must_find}

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

// script cnight_generates_dust

// UTxO

// Address(ScriptPayment(cnight_generates_dust), None)

// Value(Token(Policy(cnight_generates_dust), AssetName(""), 1))

// DustMappingDatum (Credential, DustAddress)

// script cnight_generates_dustv2

// UTxO

// Address(ScriptPayment(cnight_generates_dustv2), None)

// Value(Token(Policy(cnight_generates_dustv2), AssetName(""), 1))

// DustMappingDatum (Credential, DustAddress)

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
        // Mint/Create
        if redeemer == as_data(Create) {
          // (DG-1) Require the mint transaction to consume the ledger-selected input.
          expect [input, ..] = inputs

          let output_datum =
            input_linked_mint(
              inputs,
              mint,
              outputs,
              own_policy,
              input.output_reference,
            )

          // (DG-2) Decode the emitted datum into a `DustMappingDatum`.
          expect DustMappingDatum { c_wallet, dust_address } = output_datum

          // (DG-3) Ensure the dust address fits within 33 bytes.
          expect builtin.length_of_bytearray(dust_address) <= 33

          when c_wallet is {
            // (DG-4) VKey wallets must be represented by an extra signer.
            VerificationKey(key) -> list.has(extra_signatories, key)

            // (DG-5) Script wallets must appear in withdrawals.
            Script(_) as script ->
              list.any(withdrawals, fn(withdraw) { withdraw.1st == script })
          }
        } else {
          // Burn
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
            // (DG-11) Burning requires the mint map to record the precise NFT delta from spent inputs.
            [Pair("", spent_inputs)] == to_pairs(tokens),
            // (DG-12) Keep the helper touching `cnight_policy` so hashes stay stable.
            own_policy != config.cnight_policy,
          }
        }

      // Transaction level Script to validate all inputs in one go
      //
      Withdrawing(own_cred) -> {
        // (DG-6) Reward withdrawals must originate from the script credential.
        expect Script(own_hash) = own_cred
        let expected_nft = as_data([Pair(own_hash, [Pair("", 1)])])
        expect _ =
          list.foldl(
            inputs,
            outputs,
            fn(input, outputs) {
              if input.output.address.payment_credential == own_cred {
                expect [Output { value, datum, .. }, ..rest] = outputs

                // (DG-7) Each paired output must carry exactly one script NFT.
                expect [_, ..nft_id] = value |> to_dict |> to_pairs

                // (DG-8) The paired output must retain the same NFT identity.
                expect as_data(nft_id) == expected_nft

                // (DG-9) Replacement states must use inline datums.
                expect InlineDatum(output_datum) = datum

                // (DG-10) Re-validate the dust mapping payload.
                expect DustMappingDatum { c_wallet, dust_address } =
                  output_datum

                // (DG-3) Enforce the 33-byte dust address limit during withdrawals as well.
                expect builtin.length_of_bytearray(dust_address) <= 33

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

      // Input specific
      Spending { datum, output } -> {
        // (DG-13) Spending transactions must supply inline dust state.
        expect Some(datum) = datum
        expect DustMappingDatum { c_wallet, .. } = datum

        // (DG-14) Ensure the ledger-selected input is locked by the dust script.
        expect Script(own_hash) as script =
          must_find(inputs, fn(input) { input.output_reference == output }).output.address.payment_credential

        let minted_quantity = quantity_of(mint, own_hash, "")
        and {
          when c_wallet is {
            VerificationKey(key) -> list.has(extra_signatories, key)

            Script(_) as script ->
              list.any(withdrawals, fn(withdraw) { withdraw.1st == script })
          },
          // (DG-15) Require the transaction to either burn dust NFTs or prove script withdrawal authority for a no-mint update.
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
// inputs

// independent validation
// utxo1  -> output(tag_datum1)

// independent validation
// utxo2  ->  output(tag_datum2)

// independent validation
// utxo1 -> check for withdraw -> transaction level script aka Withdrawing  -> output1

// independent validation
// utxo2 -> check for withdraw -> transaction level script aka Withdrawing  -> output2

// Delegate -> Withdrawing getting rewards and creating a utxo from that

use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/crypto.{ScriptHash}
use aiken/interval.{Finite}
use cardano/address.{Address, Script}
use cardano/assets.{PolicyId, to_dict}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{
  DatumHash, InlineDatum, Output, OutputReference, Redeemer, Transaction,
  Withdraw,
}
use config
use logic/types_v2.{
  BurnInitToken, Init, InitTokenAction, MintInitTokens, Pause, Release,
  ReserveAction, ReserveRewardState, ReserveStagingParams, Unpause,
}
use upgradable/two_stage_upgrade.{logic_is_on_main, validate_running}
use utils.{foldr2, get_input_state_by_policy, is_singleton, must_find}
use utils_v2.{find_key, foldr}

/// The state Init writes: PR 406, Backwards Compatibility.
pub fn initial_state() -> ReserveRewardState {
  ReserveRewardState {
    curve_remaining_star: config.release_initial_reserve_star,
    cumulative_released_star: 0,
    next_interval_start_ms: config.release_anchor_posix_ms,
    paused: False,
  }
}

/// reserve_logic_v2: PR 406's Cardano Reserve Release, diagrams 10 and 12–15
/// (docs/transactions/reserve.typ). Mint, withdraw and publish; no spend.
pub fn reserve_release(
  transaction: Transaction,
  redeemer: Redeemer,
  info: ScriptInfo,
  two_stage_hash: ScriptHash,
  main_forever_hash: ScriptHash,
  main_destination_hash: ScriptHash,
  staging_params_policy: PolicyId,
  init_one_shot_ref: OutputReference,
) -> Bool {
  let Transaction {
    inputs,
    reference_inputs,
    outputs,
    mint,
    withdrawals,
    redeemers,
    validity_range,
    ..
  } = transaction

  when info is {
    Minting(own_policy) -> {
      expect action: InitTokenAction = redeemer

      let Pair(_, own_tokens) =
        mint
          |> to_dict
          |> to_pairs
          |> must_find(fn(pair) { pair.1st == own_policy })

      when action is {
        // Diagram 10: each token is minted once, against the seed UTxO.
        MintInitTokens -> {
          expect _ =
            must_find(
              inputs,
              fn(input) { input.output_reference == init_one_shot_ref },
            )

          ( own_tokens |> to_pairs ) == [Pair("main", 1), Pair("staging", 1)]
        }

        // Diagram 12: the withdrawal's Init checks exactly what is burned.
        BurnInitToken -> {
          expect Some(withdraw_redeemer) =
            find_key(redeemers, Withdraw(Script(own_policy)))

          withdraw_redeemer == as_data(Init)
        }
      }
    }

    Withdrawing(Script(own_hash)) -> {
      expect action: ReserveAction = redeemer

      let on_main = logic_is_on_main(reference_inputs, two_stage_hash, own_hash)

      // Staging track: diagram 11's params.
      let forever, night_policy, destination <-
        fn(callback) {
          if on_main {
            callback(
              main_forever_hash,
              config.cnight_policy,
              main_destination_hash,
            )
          } else {
            expect ReserveStagingParams {
              cnight_test_policy,
              forever_script_hash,
              destination_hash,
            } =
              get_input_state_by_policy(reference_inputs, staging_params_policy)

            callback(forever_script_hash, cnight_test_policy, destination_hash)
          }
        }

      let forever_cred = Script(forever)

      let forever_address = Address(forever_cred, None)

      let destination_cred = Script(destination)

      let own_tokens = find_key(mint |> to_dict |> to_pairs, own_hash)

      // At the forever address the transaction spends the state (only ADA and
      // the forever NFT) and at most one reserve NIGHT UTxO. Release spends
      // nothing at the destination: PR 406 rule 5's ICS gains exactly
      // release_delta (Release only, user decision, 11-17).
      let
        state,
        night_in,
      <-
        foldr2(
          inputs,
          None,
          None,
          fn(input, found, night, return) {
            let Output { address, value, .. } = input.output

            if address.payment_credential == forever_cred {
              if is_singleton(value, forever, "") {
                expect None = found

                return(Some(input.output), night)
              } else {
                expect None = night

                return(found, Some(value))
              }
            } else if address.payment_credential == destination_cred {
              expect action != Release

              return(found, night)
            } else {
              return(found, night)
            }
          },
        )

      expect Some(state_in) = state

      expect [Pair(_, state_in_ada), ..] = state_in.value |> to_dict |> to_pairs

      expect [Pair(_, state_in_lovelace)] = state_in_ada |> to_pairs

      // The state output by position: third in Release (diagram 13), first
      // otherwise (diagrams 12, 14 and 15).
      let state_out, rest <-
        fn(callback) {
          when action is {
            Release -> {
              expect [_, _, state_out, ..rest] = outputs

              callback(state_out, rest)
            }

            _ -> {
              expect [state_out, ..rest] = outputs

              callback(state_out, rest)
            }
          }
        }

      expect [Pair(_, state_out_ada), ..] =
        state_out.value |> to_dict |> to_pairs

      expect [Pair(_, state_out_lovelace)] = state_out_ada |> to_pairs

      // Each output is drawn: none after them at the forever address, and in
      // Release none at the destination.
      expect _ =
        foldr(
          rest,
          Void,
          fn(output, done) {
            let Output { address, .. } = output

            expect address.payment_credential != forever_cred

            if address.payment_credential == destination_cred {
              expect action != Release

              done
            } else {
              done
            }
          },
        )

      and {
        is_singleton(state_out.value, forever, ""),
        state_out.address == forever_address,
        state_out_lovelace >= state_in_lovelace,
        when action is {
          // Init ignores the state input's datum. It runs once per track
          // because its init token is one-shot and Init burns it.
          Init -> {
            expect Some(burned) = own_tokens

            expect None = night_in

            // PR 406's initial_reward_reserve, read by reference.
            expect _ =
              must_find(
                reference_inputs,
                fn(input) {
                  let Output { address, value, .. } = input.output

                  and {
                    address.payment_credential == forever_cred,
                    {
                      expect [_, ..tokens] = value |> to_dict |> to_pairs

                      as_data(tokens) == as_data(
                        [
                          Pair(
                            night_policy,
                            [
                              Pair(
                                config.cnight_name,
                                config.release_initial_reserve_star,
                              ),
                            ],
                          ),
                        ],
                      )
                    },
                  }
                },
              )

            and {
              ( burned |> to_pairs ) == [
                Pair(
                  if on_main {
                    "main"
                  } else {
                    "staging"
                  },
                  -1,
                ),
              ],
              state_out.datum == InlineDatum(initial_state()),
            }
          }

          Release -> {
            expect InlineDatum(state_datum) = state_in.datum

            expect None = own_tokens

            // Rule 1
            expect ReserveRewardState {
              curve_remaining_star,
              cumulative_released_star,
              next_interval_start_ms,
              paused: False,
            } = state_datum

            // Diagram 13: the ICS output, the reserve NIGHT output and the
            // state output come first, in this order.
            expect [destination_out, night_out, ..] = outputs

            // Rule 7: the NIGHT input holds only ADA and the compiled NIGHT.
            expect Some(night_value) = night_in

            expect [
              Pair(_, night_in_ada), Pair(night_in_policy, night_in_tokens),
            ] = night_value |> to_dict |> to_pairs

            expect [Pair(_, night_in_lovelace)] = night_in_ada |> to_pairs

            expect [Pair(night_in_name, night)] = night_in_tokens |> to_pairs

            expect [Pair(_, night_out_ada), ..night_out_tokens] =
              night_out.value |> to_dict |> to_pairs

            expect [Pair(_, night_out_lovelace)] = night_out_ada |> to_pairs

            expect [_, ..destination_tokens] =
              destination_out.value |> to_dict |> to_pairs

            expect InlineDatum(_) = destination_out.datum

            expect Finite(lower) = validity_range.lower_bound.bound_type

            expect Finite(upper) = validity_range.upper_bound.bound_type

            // Rule 4. Plutus integers are unbounded, so no step overflows.
            let release_delta = {
              let ceiling =
                (
                  curve_remaining_star * config.release_factor_n + config.release_factor_d - 1
                ) / config.release_factor_d

              if ceiling < curve_remaining_star {
                ceiling
              } else {
                curve_remaining_star
              }
            }

            and {
              // Rule 7
              night_in_policy == night_policy,
              night_in_name == config.cnight_name,
              // Rule 2
              curve_remaining_star > 0,
              // Rule 3
              upper - lower <= config.release_max_validity_window_ms,
              lower >= next_interval_start_ms + config.release_interval_ms,
              // Rule 5
              when night - release_delta is {
                0 -> night_out_tokens == []
                night_left ->
                  as_data(night_out_tokens) == as_data(
                    [Pair(night_policy, [Pair(config.cnight_name, night_left)])],
                  )
              },
              // Rule 5, the ICS
              destination_out.address == Address(destination_cred, None),
              as_data(destination_tokens) == as_data(
                [Pair(night_policy, [Pair(config.cnight_name, release_delta)])],
              ),
              // Rule 6
              state_out.datum == InlineDatum(
                ReserveRewardState {
                  curve_remaining_star: curve_remaining_star - release_delta,
                  cumulative_released_star: cumulative_released_star + release_delta,
                  next_interval_start_ms: next_interval_start_ms + config.release_interval_ms,
                  paused: False,
                },
              ),
              // Rule 8
              night_out.address == forever_address,
              night_out_lovelace >= night_in_lovelace,
              when night_out.datum is {
                DatumHash(_) -> False
                _ -> True
              },
            }
          }

          Pause | Unpause -> {
            expect InlineDatum(state_datum) = state_in.datum

            expect None = own_tokens

            expect None = night_in

            expect ReserveRewardState {
              curve_remaining_star,
              cumulative_released_star,
              next_interval_start_ms,
              ..
            } = state_datum

            // The pause authority is the `auth` on the reserve two-stage main
            // UTxO, with its `mitigation_auth` once that is set.
            expect InlineDatum(main_datum) =
              must_find(
                reference_inputs,
                fn(input) {
                  is_singleton(input.output.value, two_stage_hash, "main")
                },
              ).output.datum

            expect [_,
              _, auth, mitigation_auth, ..] = main_datum |> builtin.un_list_data

            and {
              validate_running(
                builtin.un_b_data(auth),
                builtin.un_b_data(mitigation_auth),
                withdrawals,
              ),
              state_out.datum == InlineDatum(
                ReserveRewardState {
                  curve_remaining_star,
                  cumulative_released_star,
                  next_interval_start_ms,
                  paused: action == Pause,
                },
              ),
            }
          }
        },
      }
    }

    // Diagram 10: registration only.
    Publishing { certificate: RegisterCredential { .. }, .. } -> True

    _ -> fail
  }
}

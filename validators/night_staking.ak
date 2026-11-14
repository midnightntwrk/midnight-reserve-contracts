use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/interval.{Finite}
use cardano/address.{Address, Credential, Script, VerificationKey}
use cardano/assets.{PolicyId, Value, to_dict}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, Spending, Withdrawing,
}
use cardano/transaction.{InlineDatum, Input, Output, Transaction}
use config
use registration/types.{Node, Registration}
use staking/script.{check_auth, no_script_output}
use utils.{is_singleton, must_find}

/// The inline datum of a delegation lock.
pub type DelegationLock {
  /// The key or script that authorizes every change (rule 5); never changed.
  owner: Credential,
  /// The id of the pool the cNIGHT backs.
  pool_id: ByteArray,
  /// The Midnight address that claims the rewards.
  reward_address: ByteArray,
  /// The Cardano address that receives the cNIGHT at an Unlock (rule 4).
  return_address: Address,
  /// The POSIX time of the unbond in milliseconds; None while the lock stakes.
  unbond_at: Option<Int>,
  /// Open map for Midnight; the contract does not read it.
  attributes: Pairs<ByteArray, Data>,
}

/// The redeemer of night_staking's withdrawal: the action, each with one transaction shape
/// (user decision, 11-17).
pub type StakingAction {
  Lock
  Update
  Unbond
  Unlock
}

/// NIGHT staking (MIP 421, rules 1 to 8): one script is the lock token's policy, the locks'
/// address and the stake credential whose withdrawal checks every lock transaction once,
/// by the action its redeemer names.
validator night_staking {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let Transaction {
      inputs,
      outputs,
      mint,
      reference_inputs,
      withdrawals,
      extra_signatories,
      validity_range,
      ..
    } = transaction

    when info is {
      // Rule 6, Gate.
      Minting(own_policy) -> {
        let own_cred = Script(own_policy)

        list.any(withdrawals, fn(withdraw) { withdraw.1st == own_cred })
      }

      // Rule 6, Gate.
      Spending { output, .. } -> {
        let own_input =
          must_find(
            inputs,
            fn(input: Input) { input.output_reference == output },
          )

        let own_cred = own_input.output.address.payment_credential

        list.any(withdrawals, fn(withdraw) { withdraw.1st == own_cred })
      }

      Withdrawing(own_cred) -> {
        expect Script(own_hash) = own_cred

        expect action: StakingAction = redeemer

        // Rule 7, Withdrawal: at most one input at the address.
        let spent =
          list.foldr(
            inputs,
            None,
            fn(input, spent) {
              if input.output.address.payment_credential == own_cred {
                expect None = spent

                Some(input.output)
              } else {
                spent
              }
            },
          )

        let owner =
          when action is {
            Lock -> {
              expect None = spent

              expect [output, ..rest] = outputs

              let Pair(_, tokens) =
                mint
                  |> to_dict
                  |> to_pairs
                  |> must_find(fn(pair) { pair.1st == own_hash })

              // Rule 1, Mint.
              expect [Pair("", 1)] = to_pairs(tokens)

              // Rule 7, Withdrawal: the lock is the first output.
              expect and {
                  output.address.payment_credential == own_cred,
                  no_script_output(rest, own_hash),
                }

              let lock, _, _ <- lock_output(output, own_hash)

              // Rule 2, Output: a new lock is not unbonding.
              expect None = lock.unbond_at

              // Rule 2a, Pool.
              expect pool_registered(reference_inputs, lock.pool_id)

              lock.owner
            }

            Update -> {
              expect Some(input) = spent

              expect [output, ..rest] = outputs

              // Rule 7, Withdrawal: the new lock is the first output, and nothing is
              // minted.
              expect None =
                list.find(
                  mint |> to_dict |> to_pairs,
                  fn(pair) { pair.1st == own_hash },
                )

              expect and {
                  output.address.payment_credential == own_cred,
                  no_script_output(rest, own_hash),
                }

              expect InlineDatum(datum) = input.datum

              expect before: DelegationLock = datum

              let _, cnight_before <- lock_value(input.value, own_hash)

              let after, _, cnight_after <- lock_output(output, own_hash)

              // Rule 3, Output.
              expect and {
                  before.unbond_at == None,
                  after.unbond_at == None,
                  after.owner == before.owner,
                  cnight_after >= cnight_before,
                  or {
                    after.return_address == before.return_address,
                    check_auth(
                      before.return_address.payment_credential,
                      extra_signatories,
                      withdrawals,
                    ),
                  },
                  // Rule 2a, Pool.
                  pool_registered(reference_inputs, after.pool_id),
                }

              before.owner
            }

            Unbond -> {
              expect Some(input) = spent

              expect [output, ..rest] = outputs

              // Rule 7, Withdrawal: the unbonding lock is the first output, and nothing
              // is minted.
              expect None =
                list.find(
                  mint |> to_dict |> to_pairs,
                  fn(pair) { pair.1st == own_hash },
                )

              expect and {
                  output.address.payment_credential == own_cred,
                  no_script_output(rest, own_hash),
                }

              expect InlineDatum(datum) = input.datum

              expect before: DelegationLock = datum

              let ada_before, cnight_before <- lock_value(input.value, own_hash)

              let
                after,
                ada_after,
                cnight_after,
              <- lock_output(output, own_hash)

              expect Finite(upper) = validity_range.upper_bound.bound_type

              expect Some(t) = after.unbond_at

              // Rule 3, Output: the larger datum may need more ADA, so only the ADA may
              // change.
              expect and {
                  before.unbond_at == None,
                  t >= upper,
                  after == DelegationLock {
                    owner: before.owner,
                    pool_id: before.pool_id,
                    reward_address: before.reward_address,
                    return_address: before.return_address,
                    unbond_at: Some(t),
                    attributes: before.attributes,
                  },
                  cnight_after == cnight_before,
                  ada_after >= ada_before,
                }

              before.owner
            }

            Unlock -> {
              expect Some(input) = spent

              let Pair(_, tokens) =
                mint
                  |> to_dict
                  |> to_pairs
                  |> must_find(fn(pair) { pair.1st == own_hash })

              // Rule 7, Withdrawal: no output stays at the address.
              expect no_script_output(outputs, own_hash)

              expect InlineDatum(datum) = input.datum

              expect before: DelegationLock = datum

              let _, cnight_before <- lock_value(input.value, own_hash)

              // Rule 4, Burn.
              expect and {
                  to_pairs(tokens) == [Pair("", -1)],
                  or {
                    cnight_before == 0,
                    when before.unbond_at is {
                      Some(t) ->
                        when validity_range.lower_bound.bound_type is {
                          Finite(lower) ->
                            t <= lower - config.unbonding_delay_ms
                          _ -> False
                        }
                      None -> False
                    },
                  },
                }

              // Rule 4, payout: the first output.
              expect or {
                  cnight_before == 0,
                  {
                    expect [Output { address, value, .. }, ..] = outputs

                    expect [Pair("", _),
                      Pair(cnight_policy, cnight_tokens)] =
                      value |> to_dict |> to_pairs

                    expect [Pair(cnight_name, cnight)] = to_pairs(cnight_tokens)

                    and {
                      address == before.return_address,
                      cnight_policy == config.cnight_policy,
                      cnight_name == config.cnight_name,
                      cnight >= cnight_before,
                    }
                  },
                }

              before.owner
            }
          }

        // Rule 5, Owner authorization.
        check_auth(owner, extra_signatories, withdrawals)
      }

      // Rule 8, Certificates.
      Publishing { certificate: RegisterCredential { .. }, .. } -> True

      // Rule 8, Certificates.
      _ -> fail
    }
  }
}

/// Rule 2, Output, except unbond_at, which each action checks. Returns the lock, its ADA
/// and its cNIGHT.
fn lock_output(
  output: Output,
  own_hash: PolicyId,
  return: fn(DelegationLock, Int, Int) -> result,
) -> result {
  expect InlineDatum(datum) = output.datum

  expect lock: DelegationLock = datum

  let ada, cnight <- lock_value(output.value, own_hash)

  let owner_hash =
    when lock.owner is {
      VerificationKey(hash) -> hash
      Script(hash) -> hash
    }

  let return_hash =
    when lock.return_address.payment_credential is {
      VerificationKey(hash) -> hash
      Script(hash) -> hash
    }

  // Rule 2, Output.
  expect and {
      output.address.stake_credential == None,
      ada >= config.lock_deposit_lovelace,
      builtin.length_of_bytearray(owner_hash) == 28,
      lock.owner != Script(own_hash),
      builtin.length_of_bytearray(lock.pool_id) == 28,
      builtin.length_of_bytearray(lock.reward_address) == 32,
      builtin.length_of_bytearray(return_hash) == 28,
      lock.return_address.payment_credential != Script(own_hash),
    }

  return(lock, ada, cnight)
}

/// Rule 2, Output: a lock holds ADA, the token and cNIGHT, nothing else. The token is taken
/// off first because its policy and cNIGHT's sort either way. Returns the ADA and the
/// cNIGHT.
fn lock_value(
  value: Value,
  own_hash: PolicyId,
  return: fn(Int, Int) -> result,
) -> result {
  expect [Pair("", ada_tokens), ..cnight_pairs] =
    assets.add(value, own_hash, "", -1) |> to_dict |> to_pairs

  expect [Pair(_, ada)] = to_pairs(ada_tokens)

  when cnight_pairs is {
    [] -> return(ada, 0)

    [Pair(cnight_policy, cnight_tokens)] -> {
      expect [Pair(cnight_name, cnight)] = to_pairs(cnight_tokens)

      expect and {
          cnight_policy == config.cnight_policy,
          cnight_name == config.cnight_name,
        }

      return(ada, cnight)
    }

    _ -> fail
  }
}

/// Rule 2a, Pool: a reference input is an active Registration node of the pool. Unbond and
/// Unlock do not check it, so a lock behind a pool that deactivates can still leave.
fn pool_registered(reference_inputs: List<Input>, pool_id: ByteArray) -> Bool {
  expect _ =
    must_find(
      reference_inputs,
      fn(input) {
        let Output { address, value, datum, .. } = input.output

        and {
          address.payment_credential == Script(config.night_registration_hash),
          is_singleton(value, config.night_registration_hash, ""),
          {
            expect InlineDatum(datum) = datum

            expect node: Node = datum

            when node is {
              Registration { active, pool_id: registered, .. } -> and {
                  active,
                  registered == pool_id,
                }
              _ -> False
            }
          },
        }
      },
    )

  True
}

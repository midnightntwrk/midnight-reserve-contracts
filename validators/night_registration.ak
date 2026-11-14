use aiken/builtin
use aiken/collection/dict.{to_pairs}
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{PolicyId, to_dict}
use cardano/certificate.{
  DelegateBlockProduction, DelegateBoth, DelegateCredential,
  RegisterAndDelegateCredential, RegisterCredential,
}
use cardano/script_context.{
  Minting, Publishing, ScriptContext, Spending, Withdrawing,
}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use registration/types.{
  CreateOneAnchor, CreateTwoAnchors, Deactivate, Head, Init, Node, Registration,
  RegistrationAction, Reserved, Update,
}
use staking/script.{check_auth, no_script_output}
use utils.{foldr2, is_singleton, must_find}

/// The registration set of NIGHT staking pools (MIP 421, rules 9 and 10): one script is the
/// nodes' address, the token's policy and the stake credential whose withdrawal checks
/// every transaction once, by the action its redeemer names (user decision, 11-17).
validator night_registration {
  else(ctx: ScriptContext) {
    let ScriptContext { transaction, redeemer, info } = ctx

    let Transaction {
      inputs,
      outputs,
      mint,
      extra_signatories,
      withdrawals,
      certificates,
      ..
    } = transaction

    when info is {
      // Gate.
      Minting(own_policy) -> {
        let own_cred = Script(own_policy)

        list.any(withdrawals, fn(withdraw) { withdraw.1st == own_cred })
      }

      // Gate.
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

        expect action: RegistrationAction = redeemer

        // Rule 9, Nodes: every input at the address is a node, so an input at the address
        // that is not a node cannot be spent (user decision, 11-16); at most two are
        // spent.
        let
          first,
          second,
        <-
          foldr2(
            inputs,
            None,
            None,
            fn(input, first, second, return) {
              if input.output.address.payment_credential == own_cred {
                expect is_singleton(input.output.value, own_hash, "")

                expect None = second

                return(Some(input.output), first)
              } else {
                return(first, second)
              }
            },
          )

        when action is {
          Init -> {
            let one_shot_ref =
              OutputReference(
                config.night_registration_one_shot_hash,
                config.night_registration_one_shot_index,
              )

            let Pair(_, tokens) =
              mint
                |> to_dict
                |> to_pairs
                |> must_find(fn(pair) { pair.1st == own_hash })

            // Rule 9, Nodes: the Head at outputs[0], then Reserved nodes in strictly
            // rising crch order, each linked to the next. The fold runs from the last
            // output back, so `link` is the crch of the node to the right, #"" past the
            // last node and past a Head; a node left of the Head therefore fails, and so
            // does an output between or before the nodes.
            let
              link,
              nodes,
            <-
              foldr2(
                outputs,
                #"",
                0,
                fn(output, link, nodes, return) {
                  if output.address.payment_credential == own_cred {
                    when node_output(output, own_hash) is {
                      Head { next_crch, next_pool: #"" } -> {
                        expect and {
                            next_crch == link,
                            or {
                              nodes == 0,
                              link != #"",
                            },
                          }

                        return(#"", nodes + 1)
                      }

                      Reserved { crch, next_crch } -> {
                        expect and {
                            next_crch == link,
                            bytearray.compare(#"", crch) == Less,
                            or {
                              nodes == 0,
                              bytearray.compare(crch, link) == Less,
                            },
                          }

                        return(crch, nodes + 1)
                      }

                      _ -> fail
                    }
                  } else {
                    expect and {
                        nodes == 0,
                        no_script_output([output], own_hash),
                      }

                    return(link, nodes)
                  }
                },
              )

            and {
              // Touch cnight_policy so it contributes to the script hash
              own_hash != config.cnight_policy,
              list.any(
                inputs,
                fn(input: Input) { input.output_reference == one_shot_ref },
              ),
              // Rule 9, Nodes.
              first == None,
              to_pairs(tokens) == [Pair("", nodes)],
              link == #"",
            }
          }

          Update -> {
            expect Some(node) = first

            expect None = second

            expect Registration {
              active: True,
              crch,
              next_crch,
              pool_id,
              next_pool,
              owner,
              crch_signature,
              ..
            } = node_datum(node)

            expect [node_output_after, ..rest] = outputs

            let after = node_output(node_output_after, own_hash)

            expect Registration {
              owner: new_owner,
              keys,
              signatures,
              reward_address,
              fixed_cost,
              attributes,
              ..
            } = after

            // Rule 10, Changes.
            expect None =
              list.find(
                mint |> to_dict |> to_pairs,
                fn(pair) { pair.1st == own_hash },
              )

            expect and {
                no_script_output(rest, own_hash),
                after == Registration {
                  active: True,
                  crch,
                  next_crch,
                  pool_id,
                  next_pool,
                  owner: new_owner,
                  crch_signature,
                  keys,
                  signatures,
                  reward_address,
                  fixed_cost,
                  attributes,
                },
                node_ada(node_output_after) >= node_ada(node),
              }

            // Rule 10, Changes: the owner may not hand the node to a new owner.
            or {
              list.has(extra_signatories, pool_id),
              and {
                new_owner == owner,
                check_auth(owner, extra_signatories, withdrawals),
              },
            }
          }

          // The node and its pool anchor, spent in any order.
          Deactivate -> {
            expect Some(node_a) = first

            expect Some(node_b) = second

            expect [node_output_after, anchor_output, ..rest] = outputs

            let after = node_output(node_output_after, own_hash)

            let key_a, _ <- crch_link(node_datum(node_a))

            let key_after, _ <- crch_link(after)

            let node, anchor <-
              fn(return) {
                if key_a == key_after {
                  return(node_a, node_b)
                } else {
                  return(node_b, node_a)
                }
              }

            expect Registration {
              active: True,
              crch,
              next_crch,
              pool_id,
              next_pool,
              ..
            } = node_datum(node)

            let anchor_node = node_datum(anchor)

            let _, anchor_next_pool <- pool_link(anchor_node)

            // Rule 9, Nodes.
            expect anchor_next_pool == pool_id

            // Rule 10, Changes: a deactivated node leaves the pool list for good.
            expect None =
              list.find(
                mint |> to_dict |> to_pairs,
                fn(pair) { pair.1st == own_hash },
              )

            expect and {
                no_script_output(rest, own_hash),
                after == Registration {
                  active: False,
                  crch,
                  next_crch,
                  pool_id: #"",
                  next_pool: #"",
                  owner: VerificationKey(#""),
                  crch_signature: #"",
                  keys: [],
                  signatures: [],
                  reward_address: #"",
                  fixed_cost: 0,
                  attributes: [],
                },
                node_output(anchor_output, own_hash) == with_next_pool(
                  anchor_node,
                  next_pool,
                ),
                node_ada(anchor_output) >= node_ada(anchor),
              }

            // Rule 10, Changes.
            list.has(extra_signatories, pool_id)
          }

          // CreateOneAnchor or CreateTwoAnchors. An or-pattern would compile this body
          // twice.
          _ -> {
            expect [new_output, crch_output, ..other_outputs] = outputs

            expect Registration {
              active: True,
              crch,
              next_crch,
              pool_id,
              next_pool,
              ..
            } = node_output(new_output, own_hash)

            let Pair(_, tokens) =
              mint
                |> to_dict
                |> to_pairs
                |> must_find(fn(pair) { pair.1st == own_hash })

            // Rule 9, Nodes: sorting between the anchor and its next node in both lists
            // keeps every crch, and every active pool_id, unique.
            let inserted =
              fn(crch_anchor: Node, pool_anchor: Node) {
                let crch_key, crch_next <- crch_link(crch_anchor)

                let pool_key, pool_next <- pool_link(pool_anchor)

                and {
                  bytearray.compare(crch_key, crch) == Less,
                  or {
                    crch_next == #"",
                    bytearray.compare(crch, crch_next) == Less,
                  },
                  bytearray.compare(pool_key, pool_id) == Less,
                  or {
                    pool_next == #"",
                    bytearray.compare(pool_id, pool_next) == Less,
                  },
                  next_crch == crch_next,
                  next_pool == pool_next,
                }
              }

            and {
              // Rule 10, Changes.
              to_pairs(tokens) == [Pair("", 1)],
              // Rule 10, Changes.
              when action is {
                // One anchor in both lists (diagram 7b).
                CreateOneAnchor -> {
                  expect Some(anchor) = first

                  expect None = second

                  let anchor_node = node_datum(anchor)

                  and {
                    no_script_output(other_outputs, own_hash),
                    node_output(crch_output, own_hash) == with_next_pool(
                      with_next_crch(anchor_node, crch),
                      pool_id,
                    ),
                    node_ada(crch_output) >= node_ada(anchor),
                    inserted(anchor_node, anchor_node),
                  }
                }

                // Two anchors, spent in any order (diagram 7a).
                CreateTwoAnchors -> {
                  expect Some(anchor_a) = first

                  expect Some(anchor_b) = second

                  expect [pool_output, ..rest] = other_outputs

                  let crch_after = node_output(crch_output, own_hash)

                  let key_a, _ <- crch_link(node_datum(anchor_a))

                  let key_after, _ <- crch_link(crch_after)

                  let crch_input, pool_input <-
                    fn(return) {
                      if key_a == key_after {
                        return(anchor_a, anchor_b)
                      } else {
                        return(anchor_b, anchor_a)
                      }
                    }

                  let crch_node = node_datum(crch_input)

                  let pool_node = node_datum(pool_input)

                  and {
                    no_script_output(rest, own_hash),
                    crch_after == with_next_crch(crch_node, crch),
                    node_output(pool_output, own_hash) == with_next_pool(
                      pool_node,
                      pool_id,
                    ),
                    node_ada(crch_output) >= node_ada(crch_input),
                    node_ada(pool_output) >= node_ada(pool_input),
                    inserted(crch_node, pool_node),
                  }
                }

                _ -> fail
              },
              // Rule 10, Changes.
              list.has(extra_signatories, pool_id),
              list.any(
                certificates,
                fn(certificate) {
                  let delegate =
                    when certificate is {
                      DelegateCredential { delegate, .. } -> Some(delegate)
                      RegisterAndDelegateCredential { delegate, .. } ->
                        Some(delegate)
                      _ -> None
                    }

                  when delegate is {
                    Some(DelegateBlockProduction { stake_pool }) ->
                      stake_pool == pool_id
                    Some(DelegateBoth { stake_pool, .. }) ->
                      stake_pool == pool_id
                    _ -> False
                  }
                },
              ),
            }
          }
        }
      }

      // Certificates: a registration of the credential, nothing else.
      Publishing { certificate: RegisterCredential { .. }, .. } -> True

      _ -> fail
    }
  }
}

/// Rule 9, Nodes: every node output is checked here.
fn node_output(output: Output, own_hash: PolicyId) -> Node {
  expect InlineDatum(datum) = output.datum

  expect node: Node = datum

  expect and {
      output.address == Address(Script(own_hash), None),
      is_singleton(output.value, own_hash, ""),
      when node is {
        Registration {
          active: True,
          crch,
          pool_id,
          owner,
          crch_signature,
          reward_address,
          fixed_cost,
          ..
        } -> and {
            builtin.length_of_bytearray(crch) == 32,
            builtin.length_of_bytearray(crch_signature) == 64,
            builtin.length_of_bytearray(pool_id) == 28,
            builtin.length_of_bytearray(
              when owner is {
                VerificationKey(hash) -> hash
                Script(hash) -> hash
              },
            ) == 28,
            builtin.length_of_bytearray(reward_address) == 32,
            fixed_cost >= 0,
          }
        Registration { active: False, crch, .. } ->
          builtin.length_of_bytearray(crch) == 32
        _ -> True
      },
    }

  node
}

/// The Node of a spent node.
fn node_datum(output: Output) -> Node {
  expect InlineDatum(datum) = output.datum

  expect node: Node = datum

  node
}

/// A node's ADA, read from its exact value: ADA and the token, nothing else (rule 9).
fn node_ada(output: Output) -> Int {
  expect [Pair("", ada_tokens), _] = output.value |> to_dict |> to_pairs

  expect [Pair(_, ada)] = to_pairs(ada_tokens)

  ada
}

/// A node's key and link in the crch list; the Head's key is #"".
fn crch_link(node: Node, return: fn(ByteArray, ByteArray) -> result) -> result {
  when node is {
    Head { next_crch, .. } -> return(#"", next_crch)
    Reserved { crch, next_crch } -> return(crch, next_crch)
    Registration { crch, next_crch, .. } -> return(crch, next_crch)
  }
}

/// A node's key and link in the pool list; the Head's key is #"". Reserved nodes and
/// inactive Registrations are not in the pool list.
fn pool_link(node: Node, return: fn(ByteArray, ByteArray) -> result) -> result {
  when node is {
    Head { next_pool, .. } -> return(#"", next_pool)
    Registration { active: True, pool_id, next_pool, .. } ->
      return(pool_id, next_pool)
    _ -> fail
  }
}

/// The node with its crch link set to `link`.
fn with_next_crch(node: Node, link: ByteArray) -> Node {
  when node is {
    Head { next_pool, .. } -> Head { next_crch: link, next_pool }
    Reserved { crch, .. } -> Reserved { crch, next_crch: link }
    Registration {
      active,
      crch,
      pool_id,
      next_pool,
      owner,
      crch_signature,
      keys,
      signatures,
      reward_address,
      fixed_cost,
      attributes,
      ..
    } ->
      Registration {
        active,
        crch,
        next_crch: link,
        pool_id,
        next_pool,
        owner,
        crch_signature,
        keys,
        signatures,
        reward_address,
        fixed_cost,
        attributes,
      }
  }
}

/// The node with its pool link set to `link`. A Reserved node has no pool link.
fn with_next_pool(node: Node, link: ByteArray) -> Node {
  when node is {
    Head { next_crch, .. } -> Head { next_crch, next_pool: link }
    Registration {
      active,
      crch,
      next_crch,
      pool_id,
      owner,
      crch_signature,
      keys,
      signatures,
      reward_address,
      fixed_cost,
      attributes,
      ..
    } ->
      Registration {
        active,
        crch,
        next_crch,
        pool_id,
        next_pool: link,
        owner,
        crch_signature,
        keys,
        signatures,
        reward_address,
        fixed_cost,
        attributes,
      }
    _ -> fail
  }
}

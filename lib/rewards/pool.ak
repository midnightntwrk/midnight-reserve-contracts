//// Withdraw logic of `rewards_pool_logic` (spec §9). `Receive` merges pool
//// value UTXOs: the sum of the inputs at the forever credential fits in the
//// first `[ada, night]` output at `Address(Script(forever), None)` and no
//// input carries the forever NFT.
//// `Disburse` defers every value check to the batcher withdrawal. Track
//// selection and the staging one-shot mint follow
//// `logic/next_version.logic_merge_v2`.

use aiken/builtin
use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Address, Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/certificate.{RegisterCredential}
use cardano/script_context.{Minting, Publishing, ScriptInfo, Withdrawing}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use config
use logic/types.{StagingState} as logic_types
use rewards/types.{Disburse, PoolRedeemer, Receive}
use rewards/value.{split_ada}
use upgradable/two_stage_upgrade.{logic_is_on_main}
use utils.{get_input_state_by_policy, input_linked_mint, must_find}

pub fn pool_logic(
  tx: Transaction,
  info: ScriptInfo,
  redeemer: Data,
  two_stage_hash: ScriptHash,
  one_shot_ref: OutputReference,
) -> Bool {
  let Transaction { inputs, reference_inputs, outputs, mint, withdrawals, .. } =
    tx
  when info is {
    Minting(own_policy) -> {
      let datum =
        input_linked_mint(inputs, mint, outputs, own_policy, one_shot_ref)
      expect StagingState { cnight_test_policy, forever_script_hash } = datum
      and {
        own_policy != config.cnight_policy,
        builtin.length_of_bytearray(cnight_test_policy) == 28,
        builtin.length_of_bytearray(forever_script_hash) == 28,
      }
    }
    Withdrawing(Script(own_hash)) -> {
      expect redeemer: PoolRedeemer = redeemer
      when redeemer is {
        Disburse -> {
          let batcher = Script(config.rewards_batcher_hash)
          list.any(withdrawals, fn(w) { w.1st == batcher })
        }
        Receive -> {
          let
            forever_hash,
            night_policy,
          <- track(inputs, reference_inputs, two_stage_hash, own_hash)
          merge_ok(inputs, outputs, forever_hash, night_policy)
        }
      }
    }
    Publishing { certificate: RegisterCredential { .. }, .. } -> True
    _ -> fail
  }
}

/// Main track: config hashes. Staging track: hashes from the own `StagingState` NFT input.
fn track(
  inputs: List<Input>,
  reference_inputs: List<Input>,
  two_stage_hash: ScriptHash,
  own_hash: ScriptHash,
  return: fn(ScriptHash, PolicyId) -> result,
) -> result {
  if logic_is_on_main(reference_inputs, two_stage_hash, own_hash) {
    return(config.rewards_pool_forever_hash, config.cnight_policy)
  } else {
    expect StagingState { forever_script_hash, cnight_test_policy }: StagingState =
      get_input_state_by_policy(inputs, own_hash)
    return(forever_script_hash, cnight_test_policy)
  }
}

fn merge_ok(
  inputs: List<Input>,
  outputs: List<Output>,
  forever_hash: ScriptHash,
  night_policy: PolicyId,
) -> Bool {
  let pool_cred = Script(forever_hash)
  let pool_in =
    list.foldl(
      inputs,
      assets.zero,
      fn(input, acc) {
        let Output { address, value, .. } = input.output
        if address.payment_credential == pool_cred {
          expect assets.quantity_of(value, forever_hash, "") == 0
          assets.merge(value, acc)
        } else {
          acc
        }
      },
    )
  let Output { value, datum, .. } =
    must_find(outputs, fn(o) { o.address == Address(pool_cred, None) })
  let ada_out, rest <- split_ada(value)
  expect [Pair(policy, tokens)]: Pairs<PolicyId, Pairs<AssetName, Int>> = rest
  expect [Pair(name, night_out)] = tokens
  expect InlineDatum(_) = datum
  and {
    policy == night_policy,
    name == config.cnight_name,
    ada_out >= assets.lovelace_of(pool_in),
    night_out >= assets.quantity_of(pool_in, night_policy, config.cnight_name),
  }
}

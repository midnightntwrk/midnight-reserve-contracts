use aiken/builtin
use cardano/script_context.{ScriptContext}
use cardano/transaction.{OutputReference}
use config

/// v2 stub for ICS withdrawal operations: accepts every transaction. The v2 logic is off
/// (user decision 2026-09-26); the previous body is kept below as comments.
/// No transaction id equals the hash of its one-shot reference, so the
/// check always holds; it keeps the one-shot in the script, so each stub
/// has its own hash.
validator ics_logic_v2 {
  else(ctx: ScriptContext) {
    ctx.transaction.id != builtin.blake2b_256(
      builtin.serialise_data(
        OutputReference(
          config.ics_logic_v2_one_shot_hash,
          config.ics_logic_v2_one_shot_index,
        ),
      ),
    )
  }
}
// Previous v2 code, off until v2 is taken up again:
// use cardano/script_context.{ScriptContext}
// use cardano/transaction.{OutputReference}
// use config
// use logic/next_version.{logic_merge_v2}
//
// /// Handles ICS withdrawal operations (v2).
// validator ics_logic_v2 {
//   else(ctx: ScriptContext) {
//     let ScriptContext { transaction, info, .. } = ctx
//     let one_shot_ref =
//       OutputReference(
//         config.ics_logic_v2_one_shot_hash,
//         config.ics_logic_v2_one_shot_index,
//       )
//     logic_merge_v2(
//       transaction,
//       info,
//       config.ics_forever_hash,
//       config.ics_two_stage_hash,
//       one_shot_ref,
//     )
//   }
// }

# Phase 08 — Enforce the boundaries, remove the old path

## Tasks

1. Delete what the ports left behind: `buildTx`, `completeBuilder` (if
   only `compile` uses it, make it private), the `TxBuilder`-taking
   helpers in `tx/scripts.ts`; rename the `plan*` fragments to the old
   names (`mintWitnesses`, `withdrawThroughLogic`, `registerScriptStake`).
2. `Provider.blazeFor` is read only in `tx/compile.ts`.
3. Lint gate (`eslint.config.js`): the index dependency rules as
   `no-restricted-imports` blocks per folder, and
   `MemberExpression[property.name='blazeFor']` in `no-restricted-syntax`
   outside `cli/tx/**` and `cli/chain/provider.ts`. In flat config a later
   block's options replace an earlier block's for the same rule, so every
   per-folder block repeats the existing `fs`/`child_process` bans from a
   shared constant. Probe file with one violation per rule, refused, then
   deleted (as the effect plan did for its gate).
4. README "how to add a command": resolve → `plan*` → `compile` →
   `signAndWrite`, with the dependency rules table.

One commit per task.

## Acceptance

- `grep -rln "TxBuilder" cli` lists only `cli/tx/`.
- `grep -rn "Blaze<" cli` lists only `cli/tx/` and `cli/chain/provider.ts`.
- Lint gate refuses the probe file; `just check` green.
- Build-only QA on preview for every transaction command (no
  `sign-and-submit`): same file shape and output lines as before the plan.

> **Historical reference.** This inventory documents the original `cli/` switch-case implementation. The `cli-yargs/` port has superseded it. Notable changes in cli-yargs: `--dry-run` global flag removed (was never functional), `mint-tcnight` amount changed from positional to `--amount` option, `change-terms --url` now accepts plain text (auto-hex-encoded).

# CLI Parity Inventory Checklist

Last verified against HEAD on 2026-02-14.

Scope: migration of custom parser in `cli/index.ts` to yargs while preserving current behavior unless explicitly marked as BREAK.

## 1. Switch Case Inventory (Active Surface)

All 18 cases below are active in `cli/index.ts` and wired to exports from `cli/commands/index.ts`.

| Command | Switch line (`cli/index.ts`) | Exported in `cli/commands/index.ts` | Implementation | Wiring status | No-op / behavior notes |
|---|---:|---|---|---|---|
| `deploy` | 676 | yes | `cli/commands/deploy.ts` | Wired | `dryRun` is passed but not used in command implementation. |
| `deploy-staging-track` | 714 | yes | `cli/commands/deploy-staging-track.ts` | Wired | `dryRun` is passed but not used. |
| `change-council` | 739 | yes | `cli/commands/change-council.ts` | Wired | `dryRun` is passed but not used. |
| `change-tech-auth` | 777 | yes | `cli/commands/change-tech-auth.ts` | Wired | `dryRun` is passed but not used. |
| `change-federated-ops` | 815 | yes | `cli/commands/change-federated-ops.ts` | Wired | `dryRun` is passed but not used. |
| `migrate-federated-ops` | 854 | yes | `cli/commands/migrate-federated-ops.ts` | Wired | `dryRun` is passed but not used. `--sign/--no-sign` is accepted but ignored (command always writes unsigned tx). |
| `mint-staging-state` | 893 | yes | `cli/commands/mint-staging-state.ts` | Wired | `dryRun` is passed but not used. Help text says `--use-build` required, code does not enforce. |
| `simple-tx` | 924 | yes | `cli/commands/simple-tx.ts` | Wired | `dryRun` is passed but not used. |
| `info` | 949 | yes | `cli/commands/info.ts` | Wired | `output`, `provider`, `dryRun`, and `fetch` are in options but not consumed by implementation logic. |
| `verify` | 972 | yes | `cli/commands/verify.ts` | Wired | Uses only `network`; global `provider/output/dry-run` have no effect. |
| `stage-upgrade` | 982 | yes | `cli/commands/stage-upgrade.ts` | Wired | `dryRun` is passed but not used. |
| `promote-upgrade` | 1038 | yes | `cli/commands/promote-upgrade.ts` | Wired | `dryRun` is passed but not used. |
| `register-gov-auth` | 1085 | yes | `cli/commands/register-gov-auth.ts` | Wired | `dryRun` is passed but not used. |
| `generate-key` | 1105 | yes | `cli/commands/generate-key.ts` | Wired | Uses only `network`; global `provider/output/dry-run` have no effect. |
| `sign-and-submit` | 1119 | yes | `cli/commands/sign-and-submit.ts` | Wired | Uses `network` + `provider`; global `output/dry-run` have no effect. |
| `combine-signatures` | 1146 | yes | `cli/commands/combine-signatures.ts` | Wired | Uses `network` + `provider`; global `output/dry-run` have no effect. |
| `mint-tcnight` | 1186 | yes | `cli/commands/mint-tcnight.ts` | Wired | `dryRun` is passed but not used. |
| `change-terms` | 1223 | yes | `cli/commands/change-terms.ts` | Wired | `dryRun` is passed but not used. |

### `register-logic.ts` decision (explicit and executable)

- Current state: implemented in `cli/commands/register-logic.ts` but **not exported** by `cli/commands/index.ts` and has **no switch case** in `cli/index.ts`.
- Decision: **DELETE** (do not add to `cli-yargs`).
- Execution steps during cutover:
  - Remove `cli/commands/register-logic.ts`.
  - Remove `RegisterLogicOptions` from `cli/lib/types.ts`.
  - Confirm no imports reference `register-logic`.

## 2. Flag Inventory (Type, Default, Command Usage)

Legend:
- Type reflects current custom parser behavior in `cli/index.ts`.
- "Used by" means consumed in command option building and/or command behavior.

| Flag | Short | Type (current) | Default (current) | Used by |
|---|---|---|---|---|
| `--network` | `-n` | `string` | `"local"` | All commands |
| `--output` | `-o` | `string` | `resolve("./deployments")` | `deploy`, `deploy-staging-track`, `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `mint-staging-state`, `simple-tx`, `info`, `stage-upgrade`, `promote-upgrade`, `register-gov-auth`, `mint-tcnight`, `change-terms` |
| `--provider` | `-p` | `ProviderType` | `getDefaultProvider(network)` | `deploy`, `deploy-staging-track`, `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `mint-staging-state`, `simple-tx`, `info`, `stage-upgrade`, `promote-upgrade`, `register-gov-auth`, `sign-and-submit`, `combine-signatures`, `mint-tcnight`, `change-terms` |
| `--dry-run` | none | `boolean` | `false` | Parsed globally; currently behaviorally no-op in implementations |
| `--help` | none | `boolean` | `false` | All command handlers check `options.help` |
| `--utxo-amount` | none | `bigint` via `parseAmount` | `getDeployUtxoAmount()` for deploy commands, otherwise unset | `deploy`, `deploy-staging-track`, `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `stage-upgrade`, `promote-upgrade`, `change-terms` |
| `--tech-auth-threshold` | none | threshold string `n/d` via `parseThreshold` | `getTechAuthThreshold()` | `deploy` |
| `--council-threshold` | none | threshold string `n/d` via `parseThreshold` | `getCouncilThreshold()` | `deploy` |
| `--council-staging-threshold` | none | threshold string `n/d` via `parseThreshold` | `getCouncilStagingThreshold()` | `deploy` |
| `--tech-auth-staging-threshold` | none | threshold string `n/d` via `parseThreshold` | `getTechAuthStagingThreshold()` | `deploy` |
| `--components` | none | comma-delimited `string` | `[]` (means all) | `deploy`, `deploy-staging-track` |
| `--name` | none | `string` | unset | `deploy`, `deploy-staging-track` |
| `--use-build` | none | `boolean` | `false` | `deploy-staging-track`, `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `mint-staging-state`, `info`, `stage-upgrade`, `promote-upgrade`, `register-gov-auth`, `mint-tcnight`, `change-terms` |
| `--sign` | none | `boolean` (effective: `options.sign !== false`) | `true` | `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `mint-staging-state`, `stage-upgrade`, `promote-upgrade`, `change-terms` |
| `--no-sign` | none | negation (`sign=false`) | n/a | same commands as `--sign` |
| `--output-file` | none | `string` | per command (see below) | `change-council`, `change-tech-auth`, `change-federated-ops`, `migrate-federated-ops`, `mint-staging-state`, `simple-tx`, `stage-upgrade`, `promote-upgrade`, `register-gov-auth`, `mint-tcnight`, `change-terms` |
| `--validator` | `-v` | `string` | unset | `mint-staging-state`, `stage-upgrade`, `promote-upgrade` |
| `--new-logic-hash` | none | `string` | unset | `stage-upgrade` |
| `--count` | none | `number` via `parseInt` | `getSimpleTxCount()` | `simple-tx` |
| `--amount` | none | `bigint` via `parseAmount` | `getSimpleTxAmount()` | `simple-tx` |
| `--to` | none | `string` | unset (command defaults to deployer address) | `simple-tx` |
| `--format` | none | `string` cast to `"json" | "table"` | `"table"` | `info` |
| `--component` | none | `string` | `"all"` | `info` |
| `--fetch` | none | `boolean` (strict `=== true`) | `false` | `info` (accepted but not behaviorally used) |
| `--save` | none | `boolean` (strict `=== true`) | `false` | `info` |
| `--release-dir` | none | `string` | unset (`info` uses `./release` fallback) | `info` |
| `--signing-key` | none | `string` (env var name) | `"SIGNING_PRIVATE_KEY"` | `sign-and-submit`, `combine-signatures` |
| `--sign-deployer` | none | `boolean` (effective: `!== false`) | `true` | `sign-and-submit`, `combine-signatures` |
| `--no-sign-deployer` | none | negation (`sign-deployer=false`) | n/a | `sign-and-submit`, `combine-signatures` |
| `--tx` | none | `string` | unset (required) | `combine-signatures` |
| `--signatures` | none | `string | string[] | true` (custom variadic parser) | unset (required) | `combine-signatures` |
| `--user-address` | `-u` | `string` | unset (required) | `mint-tcnight` |
| `--destination` | `-d` | `string` | unset (`destination=userAddress` at runtime) | `mint-tcnight` |
| `--burn` | `-b` | `boolean` | `false` | `mint-tcnight` |
| `--hash` | none | `string` | unset (required) | `change-terms` |
| `--url` | none | `string` | unset (required) | `change-terms` |

`--output-file` defaults by command:
- `change-council-tx.json`
- `change-tech-auth-tx.json`
- `change-federated-ops-tx.json`
- `migrate-federated-ops-tx.json`
- `mint-staging-state-tx.json`
- `simple-tx.json`
- `stage-upgrade-tx.json`
- `promote-upgrade-tx.json`
- `register-gov-auth-tx.json`
- `mint-tcnight-tx.json`
- `change-terms-tx.json`

## 3. Parser Quirks and Preserve/Break Decisions

All decisions below are explicit for yargs cutover.

| Ref (`cli/index.ts`) | Current behavior | Decision | Justification / execution note |
|---|---|---|---|
| `:592` (`arg.slice(2)` path) | Long flags parsed manually; `--no-*` stripped to `false`; unknown long flags accepted silently. | **PRESERVE** for known negation flags; **BREAK** for unknown flags. | Keep `--no-sign` and `--no-sign-deployer` behavior. Enable yargs strict option validation so unknown flags fail fast instead of being silently ignored. |
| `:602-611` (special `--signatures`) | Consumes all non-flag tokens after `--signatures`; result type is `string` for 1 item, `string[]` for many, `true` when empty. | **PRESERVE** CLI syntax, **BREAK** internal type shape. | In yargs, use array option so `--signatures a b c` still works; normalize to `string[]` always and reject empty list explicitly. |
| `:635` (short-flag value heuristic) | Value consumed only if next token does not start with `-`; otherwise flag becomes boolean `true`. Mis-parses negative values and explicit boolean values. | **BREAK** | Use typed yargs options (`string`, `number`, `boolean`) so parsing is deterministic and `--save true`/`--count -1` are handled consistently. |
| `:624-632` (`keyMap`) | Only these short aliases exist: `-n -o -p -u -d -b -v`; no short-flag bundles. | **PRESERVE** | Add explicit yargs aliases for the same flags. No bundled short options required. |
| `:654-662` top-level help | `-h` works only as first argv token; per-command `-h` does not map to `help`. | **BREAK** | Let yargs provide standard `-h/--help` for root and subcommands. |
| `:615-621` long-flag lookahead | `--flag=value` is not parsed as expected by custom parser. | **BREAK** | Accept standard `--flag=value` with yargs. |
| `:960-965` info booleans | `save`/`fetch` are true only when bare flag is present (`=== true` checks); `--save true` currently fails to enable save. | **BREAK** | Treat booleans as booleans using yargs typing. |
| `:962` `fetch: options.fetch === true` | `--fetch` accepted in CLI but not consumed by `cli/commands/info.ts` implementation. | **PRESERVE (no-op)** for migration parity. | Keep accepting `--fetch` with no behavior change in first migration pass; document as dead flag for later cleanup. |

## 4. Environment Name Patterns (Must Be Preserved)

Source: `cli/lib/network-mapping.ts`, `cli/utils/validation.ts`.

| Input pattern | Recognized as known env? | Cardano network mapping (`getCardanoNetwork`) | Aiken config section (`getAikenConfigSection`) | Decision |
|---|---|---|---|---|
| `local`, `emulator` | yes | `null` (emulator) | `default` | PRESERVE |
| `preview` | yes | `preview` | `preview` | PRESERVE |
| `qanet` | yes | `preview` | `qanet` | PRESERVE |
| `govnet` | yes | `preview` | `govnet` | PRESERVE |
| `devnet-*` | yes | `preview` | fallback `preview` | PRESERVE |
| `devnet_*` | yes | `preview` | fallback `preview` | PRESERVE |
| `node-dev-*` | yes | `preview` | exact `node-dev-01`/`node-dev-2`, otherwise fallback `preview` | PRESERVE |
| `node_dev_*` | yes | `preview` | fallback `preview` | PRESERVE |
| `preprod` | yes | `preprod` | `preprod` | PRESERVE |
| `mainnet` | yes | `mainnet` | `mainnet` | PRESERVE |
| unknown | no | warn + local/emulator fallback | `default` | PRESERVE |

## 5. Environment Variables Used Across Commands

| Env var | Where read | Required when | Default / fallback | Commands impacted |
|---|---|---|---|---|
| `DEPLOYER_ADDRESS` | `cli/lib/config.ts:getDeployerAddress()` | optional | fixed test address fallback | Most tx-building commands via `createBlaze` and direct address lookups |
| `DEPLOY_UTXO_AMOUNT` | `cli/lib/config.ts:getDeployUtxoAmount()` | optional | `20_000_000` | `deploy`, `deploy-staging-track` |
| `TECH_AUTH_THRESHOLD` | `cli/lib/config.ts:getTechAuthThreshold()` | optional | `2/3` | `deploy` |
| `COUNCIL_THRESHOLD` | `cli/lib/config.ts:getCouncilThreshold()` | optional | `2/3` | `deploy` |
| `COUNCIL_STAGING_THRESHOLD` | `cli/lib/config.ts:getCouncilStagingThreshold()` | optional | `0/1` | `deploy` |
| `TECH_AUTH_STAGING_THRESHOLD` | `cli/lib/config.ts:getTechAuthStagingThreshold()` | optional | `1/2` | `deploy` |
| `TERMS_AND_CONDITIONS_INITIAL_HASH` | `cli/lib/config.ts:getTermsAndConditionsInitialHash()` | optional | 64 zeros | `deploy` |
| `TERMS_AND_CONDITIONS_INITIAL_LINK` | `cli/lib/config.ts:getTermsAndConditionsInitialLink()` | optional | empty string | `deploy` |
| `SIMPLE_TX_COUNT` | `cli/lib/config.ts:getSimpleTxCount()` | optional | `15` | `simple-tx` |
| `SIMPLE_TX_AMOUNT` | `cli/lib/config.ts:getSimpleTxAmount()` | optional | `20_000_000` | `simple-tx` |
| `TECH_AUTH_SIGNERS` | `cli/lib/signers.ts:parseSigners*()` | required for commands that read signer sets | none | `deploy`, `deploy-staging-track`, `change-tech-auth` |
| `COUNCIL_SIGNERS` | `cli/lib/signers.ts:parseSigners*()` | required for commands that read signer sets | none | `deploy`, `deploy-staging-track`, `change-council` |
| `PERMISSIONED_CANDIDATES` | `cli/lib/candidates.ts` | required when federated ops appendix built | none | `deploy`, `deploy-staging-track`, `change-federated-ops` |
| `TECH_AUTH_PRIVATE_KEYS` | `cli/lib/signers.ts:parsePrivateKeys()` | required when signing those commands | none | `change-council`, `change-tech-auth`, `change-federated-ops`, `stage-upgrade`, `promote-upgrade`, `mint-staging-state`, `change-terms` |
| `COUNCIL_PRIVATE_KEYS` | `cli/lib/signers.ts:parsePrivateKeys()` | required when signing those commands | none | `change-council`, `change-tech-auth`, `change-federated-ops`, `promote-upgrade`, `change-terms` |
| `BLOCKFROST_PREVIEW_API_KEY` | `cli/lib/provider.ts`, `cli/commands/info.ts`, `cli/commands/verify.ts` | blockfrost on preview-mapped envs | none | Most networked commands with blockfrost + `info --save` + `verify` |
| `BLOCKFROST_PREPROD_API_KEY` | `cli/lib/provider.ts`, `cli/commands/info.ts`, `cli/commands/verify.ts` | blockfrost on preprod | none | Same |
| `BLOCKFROST_MAINNET_API_KEY` | `cli/lib/provider.ts`, `cli/commands/info.ts`, `cli/commands/verify.ts` | blockfrost on mainnet | none | Same |
| `KUPO_URL` | `cli/lib/provider.ts` | `--provider kupmios` | none | Commands using kupmios provider |
| `OGMIOS_URL` | `cli/lib/provider.ts` | `--provider kupmios` | none | Commands using kupmios provider |
| `SIGNING_PRIVATE_KEY` | default value of `--signing-key`; read via `getEnvVar(signingKeyEnvVar)` | when `sign-and-submit` / `combine-signatures` sign with deployer | none | `sign-and-submit`, `combine-signatures` |
| custom var named by `--signing-key` | `getEnvVar(signingKeyEnvVar)` | same as above | none | `sign-and-submit`, `combine-signatures` |

## 6. Non-Test Imports from `cli/` (Must Change at Cutover) -- DONE

~~Runtime (non-test) imports currently coupling `sdk/` to `cli/`:~~

All `sdk/` imports are now siloed within `sdk/` itself (no external consumers import from `sdk/`). The three internal references below remain inside `sdk/` but are inert since `sdk/` has zero external consumers and is safe to remove:

1. `sdk/transactions.ts:26` imports from `../cli/utils/transaction`.
2. `sdk/lib/tx-builders/council-operations.ts:99` dynamic imports from `../../../cli/lib/signers`.
3. `sdk/lib/tx-builders/thresholds.ts:264` dynamic imports from `../../../cli/lib/signers`.

No action needed — `sdk/` directory is fully siloed and safe to remove.

## 7. Maestro Provider Decision

Current state:
- Accepted by types and validation: `ProviderType` in `cli/lib/types.ts`, `VALID_PROVIDERS` in `cli/utils/validation.ts` include `maestro`.
- Runtime behavior: `cli/lib/provider.ts` throws for `maestro` in `createProvider()`.

Decision: **KEEP THROWING** (preserve current behavior).

Execution note:
- Keep `maestro` in accepted CLI values/types.
- Preserve runtime error path and message until upstream provider support exists.

## 8. Migration Checklist (Parity Gate)

- [ ] All 18 active switch cases are wired as yargs commands.
- [ ] Every flag in Section 2 exists with matching default and command scope.
- [ ] `--network`, `--output`, `--provider`, `--dry-run`, `--use-build`, variadic `--signatures`, and all `--no-*` behaviors are covered.
- [ ] Parser quirks in Section 3 each have implemented preserve/break behavior.
- [ ] `register-logic` is deleted and not reintroduced in `cli-yargs`.
- [ ] Environment pattern support includes `devnet-*`, `devnet_*`, `node-dev-*`, `node_dev_*`.
- [ ] All env vars in Section 5 are documented and still reachable where required.
- [x] All non-test `sdk/* -> cli/*` imports in Section 6 are removed (sdk/ is fully siloed with zero external consumers).
- [ ] Maestro remains accepted-but-throwing (or an explicit follow-up task changes this intentionally).
- [ ] `migrate-federated-ops --sign/--no-sign` and `info --fetch` current no-op semantics are either preserved or explicitly broken per Section 3 decisions.

